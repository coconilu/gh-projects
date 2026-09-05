import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../api";
import { findCheckout, useStore } from "../store";
import type { CheckoutInfo, LinkedWorkItem, Project } from "../types";

function CiDot({ st }: { st: string | null | undefined }) {
	if (!st) return null;
	return <span className={`ci ${st}`} />;
}

export function LinkBadge({ link }: { link: LinkedWorkItem | null }) {
	const set = useStore.getState;
	if (!link) return null;
	const onClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		const st = set();
		if (link.type === "issue") st.setTab("Issues");
		else st.setTab("Pull Requests");
		st.setView("projects");
	};
	return link.type === "issue" ? (
		<span className="badge b-issue" onClick={onClick}>
			● #{link.number}
		</span>
	) : (
		<span className="badge b-pr" onClick={onClick}>
			⇄ !{link.number}
		</span>
	);
}

export function abText(ahead: number, behind: number) {
	if (!ahead && !behind) return "";
	return (
		<span className="ab">
			{ahead > 0 && <span className="up">↑{ahead}</span>}
			{behind > 0 && <span className="down">↓{behind}</span>}
		</span>
	);
}

function CoBlock({
	p,
	c,
	depth,
}: {
	p: Project;
	c: CheckoutInfo;
	depth: number;
}) {
	const {
		sel,
		setSel,
		setView,
		ci,
		openDialog,
		closeDialog,
		refreshProjects,
		toast,
	} = useStore();
	const seld = sel?.kind === "checkout" && sel.cid === c.id;
	const pad = 8 + depth * 18;

	const del = async () => {
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
					toast(`已删除 worktree（回收站）：${c.path}`);
					await refreshProjects();
				} catch (e) {
					toast(`删除失败: ${e}`);
				}
			},
		});
	};

	return (
		<div className={`co-block${seld ? " sel" : ""}`}>
			<div
				className="co-line"
				style={{ paddingLeft: pad }}
				onClick={() => {
					setSel({ kind: "checkout", cid: c.id });
					setView("projects");
				}}
			>
				<span>{c.isPrimary ? "⌂" : "⎇"}</span>
				<span className="co-name grow">{c.branch}</span>
				{c.isPrimary && <span className="badge b-primary">primary</span>}
				{c.isLocked && <span className="priv">🔒</span>}
				<span className="acts">
					<button
						className="icon-btn"
						title="在编辑器打开"
						onClick={(e) => {
							e.stopPropagation();
							api.openInEditor(c.path).catch((err) => toast(`${err}`));
						}}
					>
						⇱
					</button>
					<button
						className="icon-btn"
						title="在终端打开"
						onClick={(e) => {
							e.stopPropagation();
							api.openInTerminal(c.path).catch((err) => toast(`${err}`));
						}}
					>
						❯
					</button>
					{!c.isPrimary && (
						<button
							className="icon-btn"
							title="删除（回收站）"
							onClick={(e) => {
								e.stopPropagation();
								del();
							}}
						>
							🗑
						</button>
					)}
				</span>
			</div>
			<div
				className="co-badges"
				style={{ paddingLeft: pad }}
				onClick={() => {
					setSel({ kind: "checkout", cid: c.id });
					setView("projects");
				}}
			>
				<span className="badges">
					<LinkBadge link={c.linkedWorkItem} />
					<CiDot st={ci[c.id]} />
					{abText(c.ahead, c.behind)}
				</span>
			</div>
		</div>
	);
}

export default function Sidebar() {
	const {
		projects,
		expanded,
		toggleProject,
		sel,
		setSel,
		setTab,
		view,
		setView,
		groupBy,
		setGroupBy,
		ci,
		openDialog,
		closeDialog,
		refreshProjects,
		toast,
	} = useStore();

	const openProject = (pid: string) => {
		setSel({ kind: "project", pid });
		setTab("Overview");
		setView("projects");
	};

	const addLocalFolder = () => {
		openDialog({
			kind: "prompt",
			title: "添加本地文件夹",
			message:
				"输入一个已存在的 git 仓库路径（任意 git 仓库；带 GitHub 远程时可管理 Issues/PR/Actions）",
			placeholder: "C:\\Users\\me\\gh-projects\\some-repo",
			onSubmit: async (v) => {
				closeDialog();
				try {
					await api.addExistingProject(v.trim());
					await refreshProjects();
					toast("已添加为项目");
				} catch (e) {
					toast(`添加失败: ${e}`);
				}
			},
		});
	};

	const removeProject = (p: Project) => {
		openDialog({
			kind: "confirm",
			title: `移除项目「${p.name}」？`,
			message: `主 clone 目录：${p.localPath}\n选择是否同时把目录移入回收站。`,
			okText: "移除并删除文件",
			danger: true,
			secondaryText: "仅移除（保留文件）",
			onSubmit: async () => {
				closeDialog();
				await doRemove(p, true);
			},
			onSecondary: async () => {
				closeDialog();
				await doRemove(p, false);
			},
		});
	};
	const doRemove = async (p: Project, files: boolean) => {
		try {
			await api.removeProject(p.id, files);
			await refreshProjects(false);
			toast(files ? "项目已移除，文件已入回收站" : "项目已移除（文件保留）");
		} catch (e) {
			toast(`移除失败: ${e}`);
		}
	};

	return (
		<aside className="sidebar">
			<div className="side-head">
				<div className="logo">gh</div>
				<b>gh-projects</b>
			</div>
			<div className="side-nav">
				<button
					className={`nav-chip${view === "github" ? " on" : ""}`}
					onClick={() => setView("github")}
				>
					My GitHub
				</button>
				<button
					className={`nav-chip${view === "projects" ? " on" : ""}`}
					onClick={() => setView("projects")}
				>
					Projects
				</button>
			</div>
			<div className="group-by">
				分组{" "}
				<select
					value={groupBy}
					onChange={(e) =>
						setGroupBy(e.target.value as "repo" | "status" | "ci")
					}
				>
					<option value="repo">按项目</option>
					<option value="status">按状态</option>
					<option value="ci">按 CI</option>
				</select>
			</div>
			<div className="rows">
				{groupBy === "repo" &&
					projects.map((p) => {
						const seld = sel?.kind === "project" && sel.pid === p.id;
						const open = expanded[p.id] ?? true;
						const alert = p.checkouts.some((c) => ci[c.id] === "fail");
						return (
							<div className="proj" key={p.id}>
								<div
									className={`row proj-head${seld ? " sel" : ""}`}
									onClick={() => openProject(p.id)}
								>
									<span
										className="twisty"
										onClick={(e) => {
											e.stopPropagation();
											toggleProject(p.id);
										}}
									>
										{open ? "▼" : "▶"}
									</span>
									<span className="dot" style={{ background: p.color }} />
									<span className="grow">{p.name}</span>
									{p.isPrivate && <span className="priv">私有</span>}
									{alert && <span className="alert-dot" title="有 CI 失败" />}
									<span className="count-pill">{p.checkouts.length}</span>
									<span className="acts">
										{p.providerIdentity && (
											<button
												className="icon-btn"
												title="在 GitHub 打开"
												onClick={(e) => {
													e.stopPropagation();
													openUrl(
														`https://github.com/${p.providerIdentity!.owner}/${p.providerIdentity!.repo}`,
													);
												}}
											>
												↗
											</button>
										)}
										<button
											className="icon-btn"
											title="移除项目"
											onClick={(e) => {
												e.stopPropagation();
												removeProject(p);
											}}
										>
											✕
										</button>
									</span>
								</div>
								{open &&
									p.checkouts.map((c) => (
										<CoBlock key={c.id} p={p} c={c} depth={1} />
									))}
							</div>
						);
					})}

				{groupBy !== "repo" && <FlatLanes />}

				{projects.length === 0 && (
					<div className="hint">
						还没有项目
						<br />从 My GitHub clone 一个仓库开始
					</div>
				)}
			</div>
			<div className="side-foot">
				<button onClick={() => setView("github")}>＋ Clone repository</button>
				<button onClick={addLocalFolder}>＋ Add local folder</button>
			</div>
		</aside>
	);
}

function FlatLanes() {
	const { projects, groupBy, ci, sel, setSel, setView } = useStore();
	const buckets: Record<string, { p: Project; c: CheckoutInfo }[]> = {};
	for (const p of projects)
		for (const c of p.checkouts) {
			let k: string;
			if (groupBy === "status") {
				k = c.linkedWorkItem?.type === "pr" ? "待review" : "进行中";
			} else {
				const s = ci[c.id];
				k =
					s === "ok"
						? "CI 通过"
						: s === "run"
							? "CI 进行中"
							: s === "fail"
								? "CI 失败"
								: "无 CI";
			}
			(buckets[k] ||= []).push({ p, c });
		}
	return (
		<>
			{Object.entries(buckets).map(([k, arr]) => (
				<div className="proj" key={k}>
					<div className="row proj-head" style={{ cursor: "default" }}>
						<span className="twisty">▼</span>
						<span className="grow">{k}</span>
						<span className="count-pill">{arr.length}</span>
					</div>
					{arr.map(({ p, c }) => {
						const seld = sel?.kind === "checkout" && sel.cid === c.id;
						return (
							<div
								key={c.id}
								className={`row${seld ? " sel" : ""}`}
								style={{ paddingLeft: 26 }}
								onClick={() => {
									setSel({ kind: "checkout", cid: c.id });
									setView("projects");
								}}
							>
								<span style={{ width: 14 }} />
								<span>{c.isPrimary ? "⌂" : "⎇"}</span>
								<span className="grow">
									{p.name} / {c.branch}
								</span>
								<LinkBadge link={c.linkedWorkItem} />
								<CiDot st={ci[c.id]} />
							</div>
						);
					})}
				</div>
			))}
		</>
	);
}

export { findCheckout };
