// 项目 / checkout 元数据持久化：%APPDATA%/gh-projects/projects.json

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkedWorkItem {
    #[serde(rename = "type")]
    pub kind: String, // "issue" | "pr"
    pub number: u64,
    pub title: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredCheckout {
    pub path: String,
    #[serde(default)]
    pub linked_work_item: Option<LinkedWorkItem>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderIdentity {
    pub provider: String, // "github"；预留 "gitlab" 等扩展
    pub owner: String,
    pub repo: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub id: String,
    /// GitHub 身份；本地 / 非 GitHub 远程的仓库为 None
    #[serde(default)]
    pub provider_identity: Option<ProviderIdentity>,
    /// 旧版字段：仅用于读取老 projects.json，保存时迁移为 providerIdentity
    #[serde(default, skip_serializing)]
    pub owner: Option<String>,
    #[serde(default, skip_serializing)]
    pub repo: Option<String>,
    #[serde(default)]
    pub is_private: bool,
    #[serde(default)]
    pub fork_of: Option<String>,
    pub color: String,
    pub local_path: String,
    pub added_at: i64,
    /// 仅保存元数据槽：worktree 实体以 git worktree list 为准
    #[serde(default)]
    pub checkouts: Vec<StoredCheckout>,
    /// 用户选择“仅从应用移除”的 worktree 路径（git 里还在，但不再展示）
    #[serde(default)]
    pub hidden_worktrees: Vec<String>,
}

impl StoredProject {
    /// 读取旧数据后归一化：owner/repo 提升为 providerIdentity
    pub fn normalized(mut self) -> Self {
        if self.provider_identity.is_none() {
            if let (Some(owner), Some(repo)) = (self.owner.take(), self.repo.take()) {
                self.provider_identity = Some(ProviderIdentity {
                    provider: "github".into(),
                    owner,
                    repo,
                });
            }
        }
        self
    }

    /// 展示名：GitHub 仓库名，否则目录名
    pub fn display_name(&self) -> String {
        if let Some(id) = &self.provider_identity {
            return id.repo.clone();
        }
        std::path::Path::new(&self.local_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".into())
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    #[serde(default)]
    pub projects: Vec<StoredProject>,
}

pub fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| crate::git::home_dir().join(".config"));
    base.join("gh-projects")
}

fn store_path() -> PathBuf {
    app_data_dir().join("projects.json")
}

pub fn load() -> Store {
    let p = store_path();
    match std::fs::read_to_string(&p) {
        Ok(s) => {
            let mut st: Store = serde_json::from_str(&s).unwrap_or_default();
            st.projects = st.projects.into_iter().map(StoredProject::normalized).collect();
            st
        }
        Err(_) => Store::default(),
    }
}

pub fn save(store: &Store) -> Result<(), String> {
    let p = store_path();
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    let s = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&p, s).map_err(|e| format!("写入 projects.json 失败: {e}"))
}

const PALETTE: [&str; 7] = [
    "#2f81f7", "#a371f7", "#3fb950", "#d29922", "#f85149", "#f778ba", "#76e3ea",
];

pub fn color_for(name: &str) -> String {
    let h: u32 = name.bytes().fold(0u32, |a, b| a.wrapping_mul(31).wrapping_add(b as u32));
    PALETTE[(h as usize) % PALETTE.len()].to_string()
}

pub fn new_id() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("p{t:x}")
}

pub fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
