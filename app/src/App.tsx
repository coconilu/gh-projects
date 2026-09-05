import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";
import { Dialog, Toast } from "./components/Dialog";
import FilePreview from "./components/FilePreview";
import FileTreePanel from "./components/FileTreePanel";
import LoginScreen from "./components/LoginScreen";
import MyGitHub from "./components/MyGitHub";
import ProjectDetail from "./components/ProjectDetail";
import Sidebar from "./components/Sidebar";
import { activeCheckout, useStore } from "./store";

export default function App() {
	const {
		auth,
		authLoaded,
		init,
		view,
		sel,
		projects,
		setCloneProgress,
		refreshCi,
		refreshStatusMap,
	} = useStore();
	const [update, setUpdate] = useState<Update | null>(null);
	const [updateState, setUpdateState] = useState<"idle" | "busy" | "error">(
		"idle",
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: init 等是稳定的 store 函数，只需挂载时执行一次
	useEffect(() => {
		init();
		const un = listen<string>("clone-progress", (e) =>
			setCloneProgress(e.payload),
		);
		return () => {
			un.then((f) => f());
		};
	}, []);

	// 启动时检查一次更新，此后每 30 分钟轮询；离线或检查失败不打扰用户
	useEffect(() => {
		let cancelled = false;
		const run = () =>
			check()
				.then((u) => {
					if (!cancelled && u) setUpdate(u);
				})
				.catch(() => {});
		run();
		const timer = setInterval(run, 30 * 60 * 1000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);

	// Windows NSIS：下载完成后安装器接管，自动关闭并重启到新版本
	const installUpdate = useCallback(async () => {
		if (!update) return;
		setUpdateState("busy");
		try {
			await update.downloadAndInstall();
		} catch {
			setUpdateState("error");
		}
	}, [update]);

	// 选中 checkout / 项目时：刷新文件状态与 CI 点
	// biome-ignore lint/correctness/useExhaustiveDependencies: projects.length 是项目列表变化的手动信号
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
				<div className="login-wrap" style={{ color: "var(--muted)" }}>
					加载中…
				</div>
			</div>
		);

	if (!auth?.loggedIn)
		return (
			<div className="app">
				<LoginScreen />
				<Toast />
				<UpdateToast
					update={update}
					state={updateState}
					onInstall={installUpdate}
				/>
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
								打开左侧 My GitHub，clone 一个仓库开始；或 Add local folder
								添加已有目录。
							</p>
						</div>
					</div>
				)}
			</section>
			<FileTreePanel />
			<Toast />
			<Dialog />
			<UpdateToast
				update={update}
				state={updateState}
				onInstall={installUpdate}
			/>
		</div>
	);
}

function UpdateToast({
	update,
	state,
	onInstall,
}: {
	update: Update | null;
	state: "idle" | "busy" | "error";
	onInstall: () => void;
}) {
	if (!update) return null;
	return (
		<div className="update-toast">
			<div className="update-toast-text">
				发现新版本 <b>v{update.version}</b>（当前 v{update.currentVersion}）
				{state === "busy" && (
					<div className="update-toast-sub">正在下载更新…</div>
				)}
				{state === "error" && (
					<div className="update-toast-sub error">下载失败，请重试</div>
				)}
			</div>
			<button
				className="btn primary"
				onClick={onInstall}
				disabled={state === "busy"}
			>
				立即更新
			</button>
		</div>
	);
}
