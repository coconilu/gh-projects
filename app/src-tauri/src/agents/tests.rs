use super::*;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("gitgrove-agents-{}-{stamp}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn schema() -> Value {
    let mut schema = json!({"paths":{}, "components":{"schemas":{}}});
    for (path, field) in [
        ("/api/v1/workspaces", "root"),
        ("/api/v1/sessions", "workspace_id"),
    ] {
        schema["paths"][path] = json!({"post":{"requestBody":{"content":{"application/json":{"schema":{"type":"object", "properties":{field:{"type":"string"}}}}}}}});
    }
    schema["paths"]["/api/v1/sessions"]["get"] = json!({"parameters":[
        {"name":"workspace_id","in":"query","schema":{"type":"string"}}, {"name":"page_size","in":"query","schema":{"type":"integer"}},
        {"name":"busy","in":"query","schema":{"type":"boolean"}}, {"name":"include_archive","in":"query","schema":{"type":"boolean"}},
        {"name":"exclude_empty","in":"query","schema":{"type":"boolean"}}, {"name":"archived_only","in":"query","schema":{"type":"boolean"}}
    ]});
    schema
}

#[test]
fn paths_round_trip_without_shell_interpretation() {
    let scratch = Scratch::new();
    for name in [
        "ordinary",
        "with spaces",
        "中文目录",
        "with & ampersand",
        "with # hash",
    ] {
        let path = scratch.0.join(name);
        std::fs::create_dir(&path).unwrap();
        let target = target_directory(path.to_str().unwrap()).unwrap();
        let url = codex_url(&target);
        assert_eq!(
            url.query_pairs().collect::<Vec<_>>(),
            vec![("path".into(), target.to_string_lossy())]
        );
        assert!(url.fragment().is_none());
        assert!(!target.to_string_lossy().starts_with(r"\\?\"));
    }
    assert!(target_directory("relative").is_err());
    assert!(target_directory(scratch.0.join("absent").to_str().unwrap()).is_err());
    let file = scratch.0.join("file");
    std::fs::write(&file, "a").unwrap();
    assert!(target_directory(file.to_str().unwrap()).is_err());
}

#[test]
fn discovery_only_accepts_loopback_and_real_instance_records() {
    let scratch = Scratch::new();
    let dir = scratch.0.join("server/instances");
    std::fs::create_dir_all(&dir).unwrap();
    for (idx, host) in [
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "192.168.0.4",
        "localhost",
        "127.0.0.1@example.org",
        "https://evil.test",
    ]
    .into_iter()
    .enumerate()
    {
        std::fs::write(
            dir.join(format!("{idx}.json")),
            json!({"host":host,"port":50000+idx,"pid":123,"heartbeat_at":idx}).to_string(),
        )
        .unwrap();
    }
    std::fs::write(dir.join("invalid.json"), "broken").unwrap();
    std::fs::write(
        dir.join("pending.json.tmp"),
        json!({"host":"127.0.0.1","port":12,"pid":123}).to_string(),
    )
    .unwrap();
    let found = instances(&scratch.0).unwrap();
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].base_url().unwrap().as_str(), "http://[::1]:50001/");
}

#[test]
fn incompatible_request_schema_and_unsafe_ids_are_rejected() {
    let original = schema();
    check_schema(&original).unwrap();
    let mut incompatible = original.clone();
    incompatible["paths"]["/api/v1/workspaces"]["post"]["requestBody"]["content"]
        ["application/json"]["schema"]["required"] = json!(["root", "trust"]);
    assert!(check_schema(&incompatible).is_err());
    incompatible = original.clone();
    incompatible["paths"]["/api/v1/sessions"]["get"]["parameters"]
        .as_array_mut()
        .unwrap()
        .push(json!({"name":"secret_new_field","in":"query","required":true}));
    assert!(check_schema(&incompatible).is_err());
    let mut refs = original.clone();
    refs["components"]["schemas"]["Workspace"] = refs["paths"]["/api/v1/workspaces"]["post"]
        ["requestBody"]["content"]["application/json"]["schema"]
        .clone();
    refs["paths"]["/api/v1/workspaces"]["post"]["requestBody"]["content"]["application/json"]
        ["schema"] = json!({"$ref":"#/components/schemas/Workspace"});
    check_schema(&refs).unwrap();
    for id in [
        "",
        ".",
        "..",
        "../evil",
        "//evil.test",
        "a#token=oops",
        "a?prompt=hi",
    ] {
        assert!(safe_id(&json!({"id":id}), "id").is_err());
    }
}

#[derive(Clone)]
struct Request {
    method: String,
    target: String,
    body: Value,
    auth: Option<String>,
}
struct Mock {
    base: Url,
    requests: Arc<Mutex<Vec<Request>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Mock {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Mock {
    async fn new(
        handler: impl Fn(&Request) -> (u16, String, Value) + Send + Sync + 'static,
    ) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let task = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0; 4096];
                loop {
                    let count = socket.read(&mut chunk).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let length = headers
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let end = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap();
                let headers = String::from_utf8_lossy(&bytes[..end]);
                let mut first = headers.lines().next().unwrap().split_whitespace();
                let request = Request {
                    method: first.next().unwrap().into(),
                    target: first.next().unwrap().into(),
                    body: serde_json::from_slice(&bytes[end + 4..]).unwrap_or(Value::Null),
                    auth: headers.lines().find_map(|l| {
                        l.strip_prefix("authorization:")
                            .map(|s| s.trim().to_string())
                    }),
                };
                let (status, extra_headers, body) = handler(&request);
                captured.lock().unwrap().push(request);
                let body = body.to_string();
                let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}", body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        Self {
            base,
            requests,
            task,
        }
    }
    fn kimi(&self) -> Kimi {
        Kimi {
            http: local_client().unwrap(),
            base: self.base.clone(),
            token: "test-only-secret".into(),
        }
    }
    fn register(&self, home: &Path, index: u64) {
        let dir = home.join("server/instances");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{index}.json")), json!({"host":"127.0.0.1","port":self.base.port().unwrap(),"pid":123,"heartbeat_at":index}).to_string()).unwrap();
    }
}

fn success(data: Value) -> (u16, String, Value) {
    (200, String::new(), json!({"code":0,"data":data}))
}

#[tokio::test]
async fn reopens_workspace_and_session_without_duplicate_or_prompt() {
    let scratch = Scratch::new();
    let target = target_directory(scratch.0.to_str().unwrap()).unwrap();
    let root = target.clone();
    let created = Arc::new(Mutex::new(false));
    let flag = created.clone();
    let mock = Mock::new(move |request| {
        if request.target == "/api/v1/workspaces" {
            assert_eq!(request.body, json!({"root":root}));
            return success(json!({"id":"wd_project_0123456789ab","root":root}));
        }
        if request.target.starts_with("/api/v1/sessions?") {
            assert!(request
                .target
                .contains("workspace_id=wd_project_0123456789ab"));
            let items = if *flag.lock().unwrap() {
                json!([{"id":"session-1","workspace_id":"wd_project_0123456789ab"}])
            } else {
                json!([])
            };
            return success(json!({"items":items}));
        }
        assert_eq!(request.target, "/api/v1/sessions");
        assert_eq!(request.method, "POST");
        assert_eq!(
            request.body,
            json!({"workspace_id":"wd_project_0123456789ab"})
        );
        *flag.lock().unwrap() = true;
        success(json!({"id":"session-1","workspace_id":"wd_project_0123456789ab"}))
    })
    .await;
    for _ in 0..2 {
        let url = mock.kimi().session_url(&target).await.unwrap();
        assert_eq!(url.path(), "/sessions/session-1");
        assert_eq!(url.fragment(), Some("token=test-only-secret"));
        assert!(url.query().is_none());
    }
    let requests = mock.requests.lock().unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.method == "POST" && r.target == "/api/v1/sessions")
            .count(),
        1
    );
    assert!(requests
        .iter()
        .all(|r| r.auth.as_deref() == Some("Bearer test-only-secret")));
}

#[tokio::test]
async fn auth_failure_redirect_and_business_errors_do_not_leak_credentials() {
    for (status, extra, body) in [
        (401, String::new(), json!({"msg":"test-only-secret"})),
        (
            302,
            "Location: http://127.0.0.1:1/stolen\r\n".into(),
            json!({}),
        ),
        (
            200,
            "".into(),
            json!({"code":40101,"msg":"test-only-secret"}),
        ),
        (
            200,
            "".into(),
            json!({"code":50001,"data":{"id":"wrong"},"msg":"test-only-secret"}),
        ),
    ] {
        let mock = Mock::new(move |_| (status, extra.clone(), body.clone())).await;
        let error = mock
            .kimi()
            .request(Method::POST, "api/v1/workspaces", None)
            .await
            .unwrap_err();
        assert!(!error.contains("test-only-secret"));
        assert!(!error.contains("http"));
        assert_eq!(mock.requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn multiple_instances_skip_stale_or_incompatible_before_starting() {
    let scratch = Scratch::new();
    std::fs::write(scratch.0.join("server.token"), "test-only-secret").unwrap();
    let good = Mock::new(|r| match r.target.as_str() {
        "/api/v1/healthz" => success(json!({"ok":true})),
        "/api/v1/meta" => {
            success(json!({"server_version":"future-compatible","dangerous_bypass_auth":false}))
        }
        "/openapi.json" => (200, String::new(), schema()),
        _ => panic!("unexpected route"),
    })
    .await;
    let bad = Mock::new(|r| {
        if r.target == "/api/v1/healthz" {
            success(json!({"ok":true}))
        } else {
            (401, String::new(), json!({}))
        }
    })
    .await;
    good.register(&scratch.0, 1);
    bad.register(&scratch.0, 2);
    let (selected, owned) = connect_kimi(&scratch.0).await.unwrap();
    assert_eq!(selected.base, good.base);
    assert!(owned.is_none());
    assert_eq!(bad.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn unsafe_auth_configuration_is_not_reused() {
    let mock =
        Mock::new(|_| success(json!({"server_version":"1","dangerous_bypass_auth":true}))).await;
    assert!(mock.kimi().verify().await.unwrap_err().contains("默认鉴权"));
    assert_eq!(mock.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn backend_busy_guard_rejects_direct_reentry() {
    let _guard = OPEN_LOCK.lock().await;
    let result = open_in_agent("ignored".into(), Agent::Kimi).await;
    assert!(result
        .err()
        .unwrap()
        .contains(if cfg!(windows) { "等待" } else { "Windows" }));
}

#[test]
fn server_start_uses_individual_arguments_and_neutral_cwd() {
    let home = Path::new(r"C:\Users\test\Kimi 空格 & #");
    let exe = Path::new(r"C:\Programs\Kimi Code\kimi.exe");
    let command = server_command(exe, home, 49231);
    assert_eq!(command.get_program(), exe);
    assert_eq!(command.get_current_dir(), Some(home));
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        ["web", "--host", "127.0.0.1", "--port", "49231", "--no-open"]
    );
    assert!(command
        .get_envs()
        .any(|(key, value)| key == "KIMI_CODE_HOME" && value == Some(home.as_os_str())));
}

#[tokio::test]
#[ignore = "Windows GUI acceptance: opens an external app, requires explicit target and tool"]
async fn desktop_open() {
    let path = std::env::var("GITGROVE_AGENT_TARGET")
        .expect("set GITGROVE_AGENT_TARGET to an existing absolute directory");
    let agent = match std::env::var("GITGROVE_AGENT_TOOL").as_deref() {
        Ok("codex") => Agent::Codex,
        Ok("kimi") => Agent::Kimi,
        _ => panic!("set GITGROVE_AGENT_TOOL=codex or kimi"),
    };
    let receipt = open_in_agent(path, agent).await.unwrap();
    println!("{}", receipt.message);
}

#[tokio::test]
#[ignore = "Starts a real Kimi service in an explicit isolated home; kills only the process started here"]
async fn isolated_cold_start() {
    let home = PathBuf::from(
        std::env::var("GITGROVE_TEST_KIMI_HOME").expect("set an isolated absolute Kimi home"),
    );
    assert!(home.is_absolute());
    assert!(
        instances(&home).unwrap().is_empty(),
        "test needs an isolated home with no instances"
    );
    let target = target_directory(&std::env::var("GITGROVE_AGENT_TARGET").unwrap()).unwrap();
    let (kimi, owned) = connect_kimi(&home).await.unwrap();
    assert!(owned.is_some());
    let first = kimi.session_url(&target).await.unwrap();
    let second = kimi.session_url(&target).await.unwrap();
    assert_eq!(first.path(), second.path());
    println!(
        "verified port={} path={} (credential omitted)",
        kimi.base.port().unwrap(),
        first.path()
    );
    drop(owned);
}
