// GitHub API：token 只在 Rust 侧；仓库列表用 GraphQL 聚合，其余 REST

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::AppState;

const KEYRING_SERVICE: &str = "gh-projects";
const KEYRING_USER: &str = "github-token";

/// 项目无 GitHub 身份时，按 owner/repo 调 API 的 command 统一返回该错误（前端据此降级）
fn require_repo(owner: &str, repo: &str) -> Result<(), String> {
    if owner.is_empty() || repo.is_empty() {
        Err(crate::projects::ERR_NO_GITHUB.to_string())
    } else {
        Ok(())
    }
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("keyring 不可用: {e}"))
}

/// 取 token：内存 → keyring → gh CLI（成功后写回 keyring）
pub fn ensure_token(state: &AppState) -> Result<String, String> {
    if let Some(t) = state.token.lock().unwrap().clone() {
        return Ok(t);
    }
    if let Ok(entry) = keyring_entry() {
        if let Ok(t) = entry.get_password() {
            if !t.is_empty() {
                *state.token.lock().unwrap() = Some(t.clone());
                return Ok(t);
            }
        }
    }
    Err("未登录".into())
}

fn try_gh_cli(state: &AppState) -> Option<String> {
    let out = crate::git::new_cmd("gh")
        .args(["auth", "token"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if t.is_empty() {
        return None;
    }
    // 写回 keyring
    if let Ok(entry) = keyring_entry() {
        let _ = entry.set_password(&t);
    }
    *state.token.lock().unwrap() = Some(t.clone());
    Some(t)
}

/// 直连优先、系统代理兜底的 HTTP 客户端（本机代理可能时开时关，单侧失败自动换另一侧）
pub struct Http {
    direct: reqwest::Client,
    proxied: Option<reqwest::Client>,
}

impl Http {
    pub fn new() -> Http {
        let mk = |b: reqwest::ClientBuilder| {
            b.user_agent("gh-projects/0.1")
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("failed to build http client")
        };
        // no_proxy()：禁用系统代理自动检测，保证这是纯直连 client
        let direct = mk(reqwest::Client::builder().no_proxy());
        let proxied = crate::git::system_proxy().and_then(|p| {
            reqwest::Proxy::all(&p).ok().map(|proxy| mk(reqwest::Client::builder().proxy(proxy)))
        });
        Http { direct, proxied }
    }

    /// 连接/超时失败时换另一侧 client 重试一次
    async fn send(
        &self,
        mk_req: impl Fn(&reqwest::Client) -> reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, String> {
        match mk_req(&self.direct).send().await {
            Ok(r) => Ok(r),
            Err(e) if (e.is_connect() || e.is_timeout()) && self.proxied.is_some() => {
                mk_req(self.proxied.as_ref().unwrap())
                    .send()
                    .await
                    .map_err(|e2| format!("网络错误: {e2}"))
            }
            Err(e) => Err(format!("网络错误: {e}")),
        }
    }
}

pub async fn gh_get(http: &Http, token: &str, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let url = format!("https://api.github.com{path}");
    let resp = http
        .send(|c| {
            c.get(&url)
                .bearer_auth(token)
                .query(query)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
        })
        .await?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!("GitHub API {status}: {}", &text[..text.len().min(300)]));
    }
    serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {e}"))
}

pub async fn gh_post(http: &Http, token: &str, path: &str, body: Value) -> Result<Value, String> {
    let url = format!("https://api.github.com{path}");
    let resp = http
        .send(|c| {
            c.post(&url)
                .bearer_auth(token)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .json(&body)
        })
        .await?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!("GitHub API {status}: {}", &text[..text.len().min(300)]));
    }
    if text.trim().is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {e}"))
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthState2 {
    pub logged_in: bool,
    pub login: String,
    pub name: String,
    pub avatar_url: String,
    pub source: String,
}

fn logged_out() -> AuthState2 {
    AuthState2 {
        logged_in: false,
        login: String::new(),
        name: String::new(),
        avatar_url: String::new(),
        source: String::new(),
    }
}

async fn fetch_viewer(http: &Http, token: &str, source: &str) -> Result<AuthState2, String> {
    let v = gh_get(http, token, "/user", &[]).await?;
    Ok(AuthState2 {
        logged_in: true,
        login: v["login"].as_str().unwrap_or("").to_string(),
        name: v["name"].as_str().unwrap_or("").to_string(),
        avatar_url: v["avatar_url"].as_str().unwrap_or("").to_string(),
        source: source.to_string(),
    })
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> Result<AuthState2, String> {
    // 内存 / keyring
    if let Ok(t) = ensure_token(&state) {
        return fetch_viewer(&state.http, &t, "keyring").await.or_else(|_| Ok(logged_out()));
    }
    // gh CLI 兜底
    if let Some(t) = try_gh_cli(&state) {
        return fetch_viewer(&state.http, &t, "gh CLI").await.or_else(|_| Ok(logged_out()));
    }
    Ok(logged_out())
}

#[tauri::command]
pub async fn login_pat(state: State<'_, AppState>, token: String) -> Result<AuthState2, String> {
    let me = fetch_viewer(&state.http, &token, "PAT").await?;
    let entry = keyring_entry()?;
    entry.set_password(&token).map_err(|e| format!("写入凭据管理器失败: {e}"))?;
    *state.token.lock().unwrap() = Some(token);
    Ok(me)
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.token.lock().unwrap() = None;
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub name: String,
    pub name_with_owner: String,
    pub is_private: bool,
    pub is_fork: bool,
    pub parent: Option<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub pushed_at: Option<String>,
    pub url: String,
}

/// GraphQL 一次拉全我的仓库（含私有），按 pushed_at 排序，自动翻页
#[tauri::command]
pub async fn list_my_repos(state: State<'_, AppState>) -> Result<Vec<RepoInfo>, String> {
    let token = ensure_token(&state)?;
    let query = r#"query($cursor:String){viewer{repositories(first:100,after:$cursor,orderBy:{field:PUSHED_AT,direction:DESC},affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER]){nodes{name nameWithOwner isPrivate isFork url description pushedAt primaryLanguage{name} parent{nameWithOwner}} pageInfo{hasNextPage endCursor}}}}"#;
    let mut out: Vec<RepoInfo> = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..10 {
        let body = json!({"query": query, "variables": {"cursor": cursor}});
        let v = gh_post(&state.http, &token, "/graphql", body).await?;
        if let Some(errs) = v.get("errors") {
            return Err(format!("GraphQL 错误: {errs}"));
        }
        let repos = &v["data"]["viewer"]["repositories"];
        for n in repos["nodes"].as_array().cloned().unwrap_or_default() {
            out.push(RepoInfo {
                name: n["name"].as_str().unwrap_or("").into(),
                name_with_owner: n["nameWithOwner"].as_str().unwrap_or("").into(),
                is_private: n["isPrivate"].as_bool().unwrap_or(false),
                is_fork: n["isFork"].as_bool().unwrap_or(false),
                parent: n["parent"]["nameWithOwner"].as_str().map(|s| s.to_string()),
                language: n["primaryLanguage"]["name"].as_str().map(|s| s.to_string()),
                description: n["description"].as_str().map(|s| s.to_string()),
                pushed_at: n["pushedAt"].as_str().map(|s| s.to_string()),
                url: n["url"].as_str().unwrap_or("").into(),
            });
        }
        let pi = &repos["pageInfo"];
        if pi["hasNextPage"].as_bool() == Some(true) {
            cursor = pi["endCursor"].as_str().map(|s| s.to_string());
        } else {
            break;
        }
    }
    Ok(out)
}

/// clone / 添加已有项目时补充 GitHub 元信息（私有、fork 来源）
pub async fn repo_meta(http: &Http, token: &str, owner: &str, repo: &str) -> (bool, Option<String>) {
    match gh_get(http, token, &format!("/repos/{owner}/{repo}"), &[]).await {
        Ok(v) => (
            v["private"].as_bool().unwrap_or(false),
            v["parent"]["full_name"].as_str().map(|s| s.to_string()),
        ),
        Err(_) => (false, None),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LabelInfo {
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub labels: Vec<LabelInfo>,
    pub assignee: Option<String>,
    pub url: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn list_issues(state: State<'_, AppState>, owner: String, repo: String) -> Result<Vec<IssueInfo>, String> {
    require_repo(&owner, &repo)?;
    let token = ensure_token(&state)?;
    let v = gh_get(
        &state.http,
        &token,
        &format!("/repos/{owner}/{repo}/issues"),
        &[("state", "all"), ("per_page", "100")],
    )
    .await?;
    let mut out = Vec::new();
    for i in v.as_array().cloned().unwrap_or_default() {
        if i.get("pull_request").is_some() {
            continue; // issues 端点混入 PR，过滤掉
        }
        out.push(IssueInfo {
            number: i["number"].as_u64().unwrap_or(0),
            title: i["title"].as_str().unwrap_or("").into(),
            state: i["state"].as_str().unwrap_or("open").into(),
            labels: i["labels"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|l| LabelInfo {
                    name: l["name"].as_str().unwrap_or("").into(),
                    color: l["color"].as_str().unwrap_or("6e7681").into(),
                })
                .collect(),
            assignee: i["assignees"][0]["login"].as_str().map(|s| s.to_string()),
            url: i["html_url"].as_str().unwrap_or("").into(),
            created_at: i["created_at"].as_str().unwrap_or("").into(),
        });
    }
    Ok(out)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub merged: bool,
    pub draft: bool,
    pub user: String,
    pub head_ref: String,
    pub url: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn list_prs(state: State<'_, AppState>, owner: String, repo: String) -> Result<Vec<PrInfo>, String> {
    require_repo(&owner, &repo)?;
    let token = ensure_token(&state)?;
    let v = gh_get(
        &state.http,
        &token,
        &format!("/repos/{owner}/{repo}/pulls"),
        &[("state", "all"), ("per_page", "100")],
    )
    .await?;
    Ok(v.as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|i| PrInfo {
            number: i["number"].as_u64().unwrap_or(0),
            title: i["title"].as_str().unwrap_or("").into(),
            state: i["state"].as_str().unwrap_or("open").into(),
            merged: !i["merged_at"].is_null(),
            draft: i["draft"].as_bool().unwrap_or(false),
            user: i["user"]["login"].as_str().unwrap_or("").into(),
            head_ref: i["head"]["ref"].as_str().unwrap_or("").into(),
            url: i["html_url"].as_str().unwrap_or("").into(),
            created_at: i["created_at"].as_str().unwrap_or("").into(),
        })
        .collect())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowInfo {
    pub id: u64,
    pub name: String,
    pub path: String,
    pub state: String,
}

#[tauri::command]
pub async fn list_workflows(state: State<'_, AppState>, owner: String, repo: String) -> Result<Vec<WorkflowInfo>, String> {
    require_repo(&owner, &repo)?;
    let token = ensure_token(&state)?;
    let v = gh_get(&state.http, &token, &format!("/repos/{owner}/{repo}/actions/workflows"), &[("per_page", "100")]).await?;
    Ok(v["workflows"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|w| WorkflowInfo {
            id: w["id"].as_u64().unwrap_or(0),
            name: w["name"].as_str().unwrap_or("").into(),
            path: w["path"].as_str().unwrap_or("").into(),
            state: w["state"].as_str().unwrap_or("").into(),
        })
        .collect())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    pub id: u64,
    pub run_number: u64,
    pub name: String,
    pub branch: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub actor: String,
    pub created_at: String,
    pub url: String,
}

fn parse_run(r: &Value) -> RunInfo {
    RunInfo {
        id: r["id"].as_u64().unwrap_or(0),
        run_number: r["run_number"].as_u64().unwrap_or(0),
        name: r["name"].as_str().unwrap_or("").into(),
        branch: r["head_branch"].as_str().unwrap_or("").into(),
        status: r["status"].as_str().unwrap_or("").into(),
        conclusion: r["conclusion"].as_str().map(|s| s.to_string()),
        actor: r["actor"]["login"].as_str().unwrap_or("").into(),
        created_at: r["created_at"].as_str().unwrap_or("").into(),
        url: r["html_url"].as_str().unwrap_or("").into(),
    }
}

#[tauri::command]
pub async fn list_runs(state: State<'_, AppState>, owner: String, repo: String, workflow_id: u64) -> Result<Vec<RunInfo>, String> {
    require_repo(&owner, &repo)?;
    let token = ensure_token(&state)?;
    let v = gh_get(
        &state.http,
        &token,
        &format!("/repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"),
        &[("per_page", "20")],
    )
    .await?;
    Ok(v["workflow_runs"].as_array().cloned().unwrap_or_default().iter().map(parse_run).collect())
}

#[tauri::command]
pub async fn latest_run_for_branch(state: State<'_, AppState>, owner: String, repo: String, branch: String) -> Result<Option<RunInfo>, String> {
    require_repo(&owner, &repo)?;
    let token = ensure_token(&state)?;
    let v = gh_get(
        &state.http,
        &token,
        &format!("/repos/{owner}/{repo}/actions/runs"),
        &[("branch", branch.as_str()), ("per_page", "1")],
    )
    .await?;
    Ok(v["workflow_runs"].as_array().and_then(|a| a.first()).map(parse_run))
}

#[tauri::command]
pub async fn rerun_run(state: State<'_, AppState>, owner: String, repo: String, run_id: u64) -> Result<(), String> {
    require_repo(&owner, &repo)?;
    let token = ensure_token(&state)?;
    gh_post(&state.http, &token, &format!("/repos/{owner}/{repo}/actions/runs/{run_id}/rerun"), json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_run(state: State<'_, AppState>, owner: String, repo: String, run_id: u64) -> Result<(), String> {
    require_repo(&owner, &repo)?;
    let token = ensure_token(&state)?;
    gh_post(&state.http, &token, &format!("/repos/{owner}/{repo}/actions/runs/{run_id}/cancel"), json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn dispatch_workflow(state: State<'_, AppState>, owner: String, repo: String, workflow_id: u64, r#ref: String) -> Result<(), String> {
    require_repo(&owner, &repo)?;
    let token = ensure_token(&state)?;
    gh_post(
        &state.http,
        &token,
        &format!("/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"),
        json!({"ref": r#ref}),
    )
    .await?;
    Ok(())
}

/// 创建 PR，返回 html_url
pub async fn create_pr_api(http: &Http, token: &str, owner: &str, repo: &str, title: &str, head: &str, base: &str, body: &str) -> Result<String, String> {
    let v = gh_post(
        http,
        token,
        &format!("/repos/{owner}/{repo}/pulls"),
        json!({"title": title, "head": head, "base": base, "body": body}),
    )
    .await?;
    Ok(v["html_url"].as_str().unwrap_or("").to_string())
}

/// PR 详情（head ref / title / url），供开 review worktree 用
pub async fn pr_detail(http: &Http, token: &str, owner: &str, repo: &str, number: u64) -> Result<(String, String, String), String> {
    let v = gh_get(http, token, &format!("/repos/{owner}/{repo}/pulls/{number}"), &[]).await?;
    Ok((
        v["head"]["ref"].as_str().unwrap_or("").to_string(),
        v["title"].as_str().unwrap_or("").to_string(),
        v["html_url"].as_str().unwrap_or("").to_string(),
    ))
}
