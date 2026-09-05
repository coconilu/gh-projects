import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../api";
import { useStore } from "../store";
import type { RepoInfo } from "../types";

export default function MyGitHub() {
  const {
    auth,
    myRepos,
    projects,
    refreshProjects,
    refreshMyRepos,
    reloadAuth,
    cloneProgress,
    setCloneProgress,
    toast,
    openDialog,
    closeDialog,
  } = useStore();
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const cloned = new Set(
    projects.filter((p) => p.providerIdentity).map((p) => `${p.providerIdentity!.owner}/${p.providerIdentity!.repo}`.toLowerCase())
  );
  const list = (myRepos ?? []).filter(
    (r) =>
      !q ||
      r.nameWithOwner.toLowerCase().includes(q.toLowerCase()) ||
      (r.description ?? "").toLowerCase().includes(q.toLowerCase())
  );

  const doClone = async (cloneUrl: string, repoName: string) => {
    const t = await api.checkCloneTarget(repoName);
    if (t.exists) {
      openDialog({
        kind: "confirm",
        title: "目录已存在",
        message: `${t.target}\n已存在。是否直接把它添加为已有项目？`,
        okText: "添加为已有项目",
        onSubmit: async () => {
          closeDialog();
          try {
            await api.addExistingProject(t.target);
            await refreshProjects();
            toast("已添加为已有项目");
          } catch (e) {
            toast(`添加失败: ${e}`);
          }
        },
      });
      return;
    }
    setBusy(true);
    setCloneProgress("准备克隆…");
    try {
      await api.cloneRepo(cloneUrl, repoName);
      await refreshProjects();
      toast(`已 clone 到 ${t.target} 并加入 Projects`);
    } catch (e) {
      toast(`clone 失败: ${e}`);
    } finally {
      setCloneProgress(null);
      setBusy(false);
    }
  };

  const cloneUrlRepo = async () => {
    const u = url.trim();
    const m = u.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
    if (!m) {
      toast("无法识别的 GitHub 仓库 URL");
      return;
    }
    setUrl("");
    await doClone(`https://github.com/${m[1]}/${m[2]}.git`, m[2]);
  };

  return (
    <div className="content" style={{ paddingTop: 24 }}>
      <h2>My GitHub</h2>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {auth?.avatarUrl ? (
          <img className="avatar" src={auth.avatarUrl} alt="" />
        ) : (
          <div className="logo" style={{ width: 36, height: 36, fontSize: 18 }}>
            {auth?.login?.slice(0, 2) ?? "gh"}
          </div>
        )}
        <div className="grow" style={{ flex: 1 }}>
          <b>{auth?.login}</b>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            已通过 {auth?.source} 登录 · token 存于系统凭据管理器
          </div>
        </div>
        <button className="btn" onClick={() => refreshMyRepos()}>
          刷新
        </button>
        <button
          className="btn"
          onClick={async () => {
            await api.logout();
            await reloadAuth();
          }}
        >
          退出
        </button>
      </div>

      <div className="card">
        <input
          className="input"
          placeholder="🔍 搜索我的仓库…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            className="input"
            placeholder="粘贴任意 GitHub 仓库 URL，clone 他人仓库…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && url && cloneUrlRepo()}
          />
          <button className="btn primary" disabled={busy || !url} onClick={cloneUrlRepo}>
            Clone
          </button>
        </div>
        {cloneProgress && <div className="progress-line">{cloneProgress}</div>}
      </div>

      <div className="card" style={{ padding: "4px 8px" }}>
        {!myRepos && <div className="repo-row">加载中…</div>}
        {myRepos?.length === 0 && <div className="repo-row">没有仓库</div>}
        {list.map((r) => (
          <RepoRow key={r.nameWithOwner} r={r} cloned={cloned.has(r.nameWithOwner.toLowerCase())} busy={busy} onClone={doClone} />
        ))}
      </div>
    </div>
  );
}

function RepoRow({
  r,
  cloned,
  busy,
  onClone,
}: {
  r: RepoInfo;
  cloned: boolean;
  busy: boolean;
  onClone: (url: string, name: string) => void;
}) {
  const sub = [
    r.isFork && r.parent ? `fork 自 ${r.parent}` : null,
    r.language,
    r.pushedAt ? `更新于 ${relTime(r.pushedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="repo-row">
      <span className="dot" style={{ background: cloned ? "#3fb950" : "#6e7681" }} />
      <span className="grow">
        {r.nameWithOwner} {r.isPrivate && <span className="priv">私有</span>}
        <div className="sub">{sub || r.description || ""}</div>
      </span>
      {cloned ? (
        <span className="badge b-primary">已在 Projects</span>
      ) : (
        <>
          <button
            className="btn sm"
            title="在 GitHub 打开"
            onClick={() => openUrl(r.url)}
          >
            ↗
          </button>
          <button
            className="btn sm primary"
            disabled={busy}
            onClick={() => onClone(`https://github.com/${r.nameWithOwner}.git`, r.name)}
          >
            Clone
          </button>
        </>
      )}
    </div>
  );
}

export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400 / 7)} 周前`;
  return new Date(t).toLocaleDateString();
}
