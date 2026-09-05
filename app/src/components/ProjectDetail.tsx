import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { marked } from "marked";
import * as api from "../api";
import { useStore } from "../store";
import { LinkBadge, abText } from "./Sidebar";
import { relTime } from "./MyGitHub";
import type {
  BranchInfo,
  CheckoutInfo,
  IssueInfo,
  PrInfo,
  Project,
  RunInfo,
  WorkflowInfo,
} from "../types";

const TABS = ["Overview", "Worktrees & Branches", "Issues", "Pull Requests", "Actions"];

export default function ProjectDetail({ p }: { p: Project }) {
  const { tab, setTab } = useStore();
  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`tab${t === tab ? " on" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="content">
        <div className="crumb">
          Projects / <b>{p.name}</b> / {tab}
        </div>
        {tab === "Overview" && <Overview p={p} />}
        {tab === "Worktrees & Branches" && <WorktreesBranches p={p} />}
        {tab === "Issues" && <Issues p={p} />}
        {tab === "Pull Requests" && <Prs p={p} />}
        {tab === "Actions" && <Actions p={p} />}
      </div>
    </>
  );
}

/* ---------------- 无 GitHub 身份的空状态 ---------------- */
function NoGitHub({ title }: { title: string }) {
  return (
    <>
      <h2>{title}</h2>
      <div className="card" style={{ padding: 28, color: "var(--muted)", textAlign: "center", lineHeight: 1.8 }}>
        该项目未关联 GitHub 仓库（仅支持 github.com 远程）。
        <br />
        本地 git 功能（worktree / 分支 / 文件树）不受影响。
      </div>
    </>
  );
}

/* ---------------- Overview ---------------- */
function Overview({ p }: { p: Project }) {
  const [readme, setReadme] = useState<string | null>(null);
  const [issues, setIssues] = useState<IssueInfo[] | null>(null);
  const [prs, setPrs] = useState<PrInfo[] | null>(null);
  const [ci, setCi] = useState<string | null>(null);
  const gh = p.providerIdentity;

  useEffect(() => {
    setReadme(null);
    setIssues(null);
    setPrs(null);
    setCi(null);
    api
      .readFilePreview(`${p.localPath}/README.md`)
      .then((f) => setReadme(f.isBinary ? null : f.text))
      .catch(() => setReadme(null));
    if (!gh) {
      setIssues([]);
      setPrs([]);
      setCi("none");
      return;
    }
    api.listIssues(gh.owner, gh.repo).then(setIssues).catch(() => setIssues([]));
    api.listPrs(gh.owner, gh.repo).then(setPrs).catch(() => setPrs([]));
    const primary = p.checkouts.find((c) => c.isPrimary);
    if (primary)
      api
        .latestRunForBranch(gh.owner, gh.repo, primary.branch)
        .then((r) =>
          setCi(!r ? "none" : r.status !== "completed" ? "run" : r.conclusion === "success" ? "ok" : "fail")
        )
        .catch(() => setCi("none"));
  }, [p.id]);

  const openIssues = issues?.filter((i) => i.state === "open").length ?? 0;
  const openPrs = prs?.filter((x) => x.state === "open").length ?? 0;

  return (
    <>
      <h2>
        {gh ? `${gh.owner}/${gh.repo}` : p.name} {p.isPrivate && <span className="priv">私有</span>}{" "}
        {p.forkOf && <span className="priv">fork 自 {p.forkOf}</span>}
        {!gh && <span className="priv">本地仓库</span>}
      </h2>
      <div className="stat-row">
        <div className="stat">
          <b>{openIssues}</b>
          <span>Open issues</span>
        </div>
        <div className="stat">
          <b>{openPrs}</b>
          <span>Open PRs</span>
        </div>
        <div className="stat">
          <b>{p.checkouts.length}</b>
          <span>Checkouts</span>
        </div>
        <div className="stat">
          <b style={{ color: ci === "fail" ? "var(--red)" : "var(--green)" }}>
            {ci === "fail" ? "✗" : ci === "run" ? "…" : ci === "ok" ? "✓" : "—"}
          </b>
          <span>最近 CI</span>
        </div>
      </div>
      {readme && (
        <div
          className="card md"
          dangerouslySetInnerHTML={{ __html: marked.parse(readme) as string }}
        />
      )}
    </>
  );
}

/* ---------------- Worktrees & Branches ---------------- */
export function useCoOps(p: Project) {
  const { openDialog, closeDialog, refreshProjects, toast } = useStore();
  return {
    openEditor: (c: CheckoutInfo) =>
      api.openInEditor(c.path).catch((e) => toast(`${e}`)),
    openTerm: (c: CheckoutInfo) =>
      api.openInTerminal(c.path).catch((e) => toast(`${e}`)),
    del: (c: CheckoutInfo) =>
      openDialog({
        kind: "confirm",
        title: `删除 worktree「${c.branch}」？`,
        message: `[确定] 移入回收站（文件可从回收站恢复）\n[取消] 不动`,
        danger: true,
        okText: "删除",
        onSubmit: async () => {
          closeDialog();
          try {
            await api.removeWorktree(p.id, c.path, true);
            await refreshProjects();
            toast("已删除 worktree（回收站）");
          } catch (e) {
            toast(`删除失败: ${e}`);
          }
        },
      }),
    lock: async (c: CheckoutInfo) => {
      try {
        await api.lockWorktree(c.path, !c.isLocked);
        await refreshProjects();
        toast(c.isLocked ? "已解锁" : "已锁定");
      } catch (e) {
        toast(`${e}`);
      }
    },
    createPr: (c: CheckoutInfo) => {
      const body = c.linkedWorkItem?.type === "issue" ? `Closes #${c.linkedWorkItem.number}` : "";
      openDialog({
        kind: "prompt",
        title: "创建 Pull Request",
        message: `分支 ${c.branch} → 默认分支${body ? `，正文自动填「${body}」` : ""}`,
        placeholder: "PR 标题",
        defaultValue: c.linkedWorkItem?.title ?? c.branch,
        onSubmit: async (v) => {
          closeDialog();
          try {
            const url = await api.createPr(p.id, c.path, v.trim() || c.branch, body);
            toast("PR 已创建");
            openUrl(url);
          } catch (e) {
            toast(`创建 PR 失败: ${e}`);
          }
        },
      });
    },
  };
}

function WorktreesBranches({ p }: { p: Project }) {
  const { ci, openDialog, closeDialog, refreshProjects, toast } = useStore();
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const ops = useCoOps(p);

  const load = () => api.listBranches(p.id).then(setBranches).catch((e) => toast(`${e}`));
  useEffect(() => {
    setBranches(null);
    load();
  }, [p.id]);

  const newWorktree = () => {
    openDialog({
      kind: "prompt",
      title: "新建 worktree",
      message: "输入新分支名；将从默认分支创建，目录落在兄弟目录 <repo>.worktrees/<slug>/",
      placeholder: "feat/some-thing",
      onSubmit: async (v) => {
        closeDialog();
        const branch = v.trim();
        if (!branch) return;
        try {
          await api.createWorktree(p.id, branch, null, true, null);
          await refreshProjects();
          toast(`已创建 worktree ${branch}`);
        } catch (e) {
          toast(`创建失败: ${e}`);
        }
      },
    });
  };

  const spawnFromBranch = async (b: BranchInfo) => {
    try {
      await api.createWorktree(p.id, b.name, null, false, null);
      await refreshProjects();
      toast(`已为 ${b.name} 创建 worktree`);
    } catch (e) {
      toast(`创建失败: ${e}`);
    }
  };

  return (
    <>
      <h2>Worktrees & Branches</h2>
      <div className="two-col">
        <div>
          {p.checkouts.map((c) => (
            <div className="co-card" key={c.id}>
              <h4>
                {c.isPrimary ? "⌂" : "⎇"} {c.branch}{" "}
                {c.isPrimary && <span className="badge b-primary">primary</span>}
                {c.isLocked && <span className="priv">🔒</span>}
                {ci[c.id] && <span className={`ci ${ci[c.id]}`} />}
              </h4>
              <div className="meta">
                {c.path}
                <br />
                {c.ahead || c.behind ? <>{abText(c.ahead, c.behind)}</> : "与远程同步"}
                {c.linkedWorkItem &&
                  ` · 关联 ${c.linkedWorkItem.type === "issue" ? "#" : "!"}${c.linkedWorkItem.number}`}
              </div>
              <div className="ops">
                <button className="btn sm" onClick={() => ops.openEditor(c)}>编辑器</button>
                <button className="btn sm" onClick={() => ops.openTerm(c)}>终端</button>
                {!c.isPrimary && (
                  <button className="btn sm" onClick={() => ops.lock(c)}>
                    {c.isLocked ? "解锁" : "锁定"}
                  </button>
                )}
                {!c.isPrimary && p.providerIdentity && (
                  <button className="btn sm primary" onClick={() => ops.createPr(c)}>创建 PR</button>
                )}
                {!c.isPrimary && (
                  <button className="btn sm danger" onClick={() => ops.del(c)}>删除</button>
                )}
              </div>
            </div>
          ))}
          <button className="btn" onClick={newWorktree}>＋ 新建 worktree</button>
        </div>
        <div>
          <table>
            <thead>
              <tr>
                <th>分支</th>
                <th>ahead/behind</th>
                <th>最后提交</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!branches && (
                <tr><td className="id" colSpan={4}>加载中…</td></tr>
              )}
              {branches?.map((b) => (
                <tr key={`${b.remote ? "r" : "l"}:${b.name}`}>
                  <td>{b.name}</td>
                  <td>{abText(b.ahead, b.behind) || "—"}</td>
                  <td className="id" title={b.subject}>
                    {b.lastCommitTs ? relTime(new Date(b.lastCommitTs * 1000).toISOString()) : "—"}
                  </td>
                  <td>
                    {!b.remote && (
                      <button className="btn sm" onClick={() => spawnFromBranch(b)}>
                        ⎇ 开 worktree
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------------- Issues ---------------- */
function Issues({ p }: { p: Project }) {
  const { refreshProjects, setSel, setView, toast } = useStore();
  const [issues, setIssues] = useState<IssueInfo[] | null>(null);
  const [busy, setBusy] = useState(0);
  const gh = p.providerIdentity;

  useEffect(() => {
    setIssues(null);
    if (!gh) return;
    api.listIssues(gh.owner, gh.repo).then(setIssues).catch((e) => toast(`${e}`));
  }, [p.id]);

  if (!gh) return <NoGitHub title="Issues" />;

  const linked = (n: number) =>
    p.checkouts.find((c) => c.linkedWorkItem?.type === "issue" && c.linkedWorkItem.number === n);

  const spawn = async (i: IssueInfo) => {
    setBusy(i.number);
    try {
      const co = await api.spawnIssueWorktree(p.id, i.number, i.title);
      await refreshProjects();
      setSel({ kind: "checkout", cid: co.id });
      setView("projects");
      toast(`已创建 worktree ${co.branch} 并关联 #${i.number}`);
    } catch (e) {
      toast(`创建失败: ${e}`);
    } finally {
      setBusy(0);
    }
  };

  return (
    <>
      <h2>Issues</h2>
      <div className="card" style={{ padding: "4px 0" }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>标题</th>
              <th>标签</th>
              <th>负责人</th>
              <th>关联 worktree</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!issues && <tr><td className="id" colSpan={6}>加载中…</td></tr>}
            {issues?.map((i) => {
              const co = linked(i.number);
              return (
                <tr key={i.number}>
                  <td className="id">#{i.number}</td>
                  <td>
                    <span className={i.state === "open" ? "st-open" : "st-closed"}>●</span>{" "}
                    <a onClick={() => openUrl(i.url)} style={{ cursor: "pointer" }}>{i.title}</a>
                  </td>
                  <td>
                    {i.labels.map((l) => (
                      <span
                        key={l.name}
                        className="label-chip"
                        style={{ color: `#${l.color}`, borderColor: `#${l.color}40` }}
                      >
                        {l.name}
                      </span>
                    ))}
                  </td>
                  <td className="id">{i.assignee ?? "—"}</td>
                  <td>{co ? <span className="badge b-issue">⎇ {co.branch}</span> : "—"}</td>
                  <td>
                    {co ? (
                      <button
                        className="btn sm"
                        onClick={() => {
                          setSel({ kind: "checkout", cid: co.id });
                          setView("projects");
                        }}
                      >
                        跳转
                      </button>
                    ) : (
                      <button
                        className="btn sm primary"
                        disabled={busy === i.number}
                        onClick={() => spawn(i)}
                      >
                        {busy === i.number ? "创建中…" : "开 worktree"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Pull Requests ---------------- */
function Prs({ p }: { p: Project }) {
  const { refreshProjects, setSel, setView, toast } = useStore();
  const [prs, setPrs] = useState<PrInfo[] | null>(null);
  const [checks, setChecks] = useState<Record<number, string | null>>({});
  const [busy, setBusy] = useState(0);
  const gh = p.providerIdentity;

  useEffect(() => {
    setPrs(null);
    setChecks({});
    if (!gh) return;
    api
      .listPrs(gh.owner, gh.repo)
      .then(async (list) => {
        setPrs(list);
        for (const pr of list.slice(0, 20)) {
          try {
            const r = await api.latestRunForBranch(gh.owner, gh.repo, pr.headRef);
            setChecks((m) => ({
              ...m,
              [pr.number]: !r ? null : r.status !== "completed" ? "run" : r.conclusion === "success" ? "ok" : "fail",
            }));
          } catch {
            /* ignore */
          }
        }
      })
      .catch((e) => toast(`${e}`));
  }, [p.id]);

  if (!gh) return <NoGitHub title="Pull Requests" />;

  const linked = (n: number) =>
    p.checkouts.find((c) => c.linkedWorkItem?.type === "pr" && c.linkedWorkItem.number === n);

  const spawn = async (pr: PrInfo) => {
    setBusy(pr.number);
    try {
      const co = await api.spawnPrWorktree(p.id, pr.number);
      await refreshProjects();
      setSel({ kind: "checkout", cid: co.id });
      setView("projects");
      toast(`已为 PR #${pr.number} 创建 review worktree`);
    } catch (e) {
      toast(`创建失败: ${e}`);
    } finally {
      setBusy(0);
    }
  };

  return (
    <>
      <h2>Pull Requests</h2>
      <div className="card" style={{ padding: "4px 0" }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>标题</th>
              <th>checks</th>
              <th>分支</th>
              <th>关联 worktree</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!prs && <tr><td className="id" colSpan={6}>加载中…</td></tr>}
            {prs?.map((pr) => {
              const co = linked(pr.number);
              const ck = checks[pr.number];
              return (
                <tr key={pr.number}>
                  <td className="id">#{pr.number}</td>
                  <td>
                    <span className={pr.merged ? "st-merged" : pr.state === "open" ? "st-open" : "st-closed"}>
                      {pr.merged ? "⇄" : "●"}
                    </span>{" "}
                    <a onClick={() => openUrl(pr.url)} style={{ cursor: "pointer" }}>
                      {pr.title}
                    </a>
                    {pr.draft && <span className="priv" style={{ marginLeft: 6 }}>draft</span>}
                  </td>
                  <td>{ck ? <span className={`ci ${ck}`} /> : "—"}</td>
                  <td className="id">{pr.headRef}</td>
                  <td>{co ? <span className="badge b-pr">⎇ {co.branch}</span> : "—"}</td>
                  <td>
                    {pr.state === "open" &&
                      (co ? (
                        <button
                          className="btn sm"
                          onClick={() => {
                            setSel({ kind: "checkout", cid: co.id });
                            setView("projects");
                          }}
                        >
                          跳转
                        </button>
                      ) : (
                        <button
                          className="btn sm primary"
                          disabled={busy === pr.number}
                          onClick={() => spawn(pr)}
                        >
                          {busy === pr.number ? "创建中…" : "开 worktree review"}
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Actions ---------------- */
function Actions({ p }: { p: Project }) {
  const { toast, openDialog, closeDialog } = useStore();
  const [wfs, setWfs] = useState<WorkflowInfo[] | null>(null);
  const [cur, setCur] = useState(0);
  const [runs, setRuns] = useState<RunInfo[] | null>(null);
  const gh = p.providerIdentity;

  const loadRuns = (idx: number, list?: WorkflowInfo[]) => {
    const w = (list ?? wfs)?.[idx];
    if (!w || !gh) return;
    setRuns(null);
    api.listRuns(gh.owner, gh.repo, w.id).then(setRuns).catch((e) => toast(`${e}`));
  };

  useEffect(() => {
    setWfs(null);
    setCur(0);
    if (!gh) return;
    api
      .listWorkflows(gh.owner, gh.repo)
      .then((list) => {
        setWfs(list);
        if (list.length) loadRuns(0, list);
      })
      .catch((e) => toast(`${e}`));
  }, [p.id]);

  if (!gh) return <NoGitHub title="Actions" />;

  const wf = wfs?.[cur];
  const runCi = (r: RunInfo) =>
    r.status !== "completed" ? "run" : r.conclusion === "success" ? "ok" : "fail";

  const dispatch = () => {
    if (!wf) return;
    openDialog({
      kind: "prompt",
      title: `手动 dispatch「${wf.name}」`,
      placeholder: "ref（分支/tag）",
      defaultValue: "main",
      onSubmit: async (v) => {
        closeDialog();
        try {
          await api.dispatchWorkflow(gh.owner, gh.repo, wf.id, v.trim() || "main");
          toast("已触发 dispatch");
          setTimeout(() => loadRuns(cur), 1500);
        } catch (e) {
          toast(`dispatch 失败: ${e}`);
        }
      },
    });
  };

  return (
    <>
      <h2>Actions</h2>
      <div className="actions-wrap">
        <div className="card" style={{ padding: 6 }}>
          {!wfs && <div className="wf">加载中…</div>}
          {wfs?.map((w, i) => (
            <div
              key={w.id}
              className={`wf${i === cur ? " on" : ""}`}
              onClick={() => {
                setCur(i);
                loadRuns(i);
              }}
            >
              <span>{w.name}</span>
            </div>
          ))}
          <div style={{ padding: 8 }}>
            <button className="btn sm" style={{ width: "100%" }} onClick={dispatch}>
              ▶ 手动 dispatch
            </button>
          </div>
        </div>
        <div className="card" style={{ padding: "4px 0" }}>
          {!runs && <div className="run"><span className="id">加载中…</span></div>}
          {runs?.map((r) => (
            <div className="run" key={r.id}>
              <span className={`ci ${runCi(r)}`} />
              <span className="grow">
                <b>#{r.runNumber}</b> · {r.branch}
                <div className="t">
                  {r.actor} · {relTime(r.createdAt)} · {r.conclusion ?? r.status}
                </div>
              </span>
              <button className="btn sm" onClick={() => openUrl(r.url)}>日志</button>
              {r.conclusion === "failure" && (
                <button
                  className="btn sm"
                  onClick={async () => {
                    try {
                      await api.rerunRun(gh.owner, gh.repo, r.id);
                      toast("已触发 rerun");
                      setTimeout(() => loadRuns(cur), 1500);
                    } catch (e) {
                      toast(`${e}`);
                    }
                  }}
                >
                  ↻ rerun
                </button>
              )}
              {r.status !== "completed" && (
                <button
                  className="btn sm"
                  onClick={async () => {
                    try {
                      await api.cancelRun(gh.owner, gh.repo, r.id);
                      toast("已取消");
                      setTimeout(() => loadRuns(cur), 1500);
                    } catch (e) {
                      toast(`${e}`);
                    }
                  }}
                >
                  ✕ cancel
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export { LinkBadge };
