import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore, activeCheckout } from "./store";
import Sidebar from "./components/Sidebar";
import MyGitHub from "./components/MyGitHub";
import ProjectDetail from "./components/ProjectDetail";
import FileTreePanel from "./components/FileTreePanel";
import FilePreview from "./components/FilePreview";
import LoginScreen from "./components/LoginScreen";
import { Dialog, Toast } from "./components/Dialog";

export default function App() {
  const { auth, authLoaded, init, view, sel, projects, setCloneProgress, refreshCi, refreshStatusMap } =
    useStore();

  useEffect(() => {
    init();
    const un = listen<string>("clone-progress", (e) => setCloneProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // 选中 checkout / 项目时：刷新文件状态与 CI 点
  useEffect(() => {
    const hit = activeCheckout(projects, sel);
    if (hit) {
      refreshStatusMap(hit.c);
      if (sel?.kind === "project") refreshCi(hit.p);
    }
  }, [sel, projects.length]);

  if (!authLoaded)
    return (
      <div className="app">
        <div className="login-wrap" style={{ color: "var(--muted)" }}>加载中…</div>
      </div>
    );

  if (!auth?.loggedIn)
    return (
      <div className="app">
        <LoginScreen />
        <Toast />
      </div>
    );

  const pid =
    sel?.kind === "project"
      ? sel.pid
      : sel
        ? activeCheckout(projects, sel)?.p.id
        : projects[0]?.id;
  const project = projects.find((x) => x.id === pid) ?? projects[0];

  return (
    <div className="app">
      <Sidebar />
      <section className="main">
        {view === "github" ? (
          <MyGitHub />
        ) : sel?.kind === "file" ? (
          <FilePreview fkey={sel.key} co={sel.co} />
        ) : project ? (
          <ProjectDetail key={project.id} p={project} />
        ) : (
          <div className="content">
            <div className="card" style={{ textAlign: "center", padding: 40 }}>
              <h2>还没有项目</h2>
              <p style={{ color: "var(--muted)" }}>
                打开左侧 My GitHub，clone 一个仓库开始；或 Add local folder 添加已有目录。
              </p>
            </div>
          </div>
        )}
      </section>
      <FileTreePanel />
      <Toast />
      <Dialog />
    </div>
  );
}
