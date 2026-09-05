import { create } from "zustand";
import * as api from "./api";
import type {
  AuthState,
  CheckoutInfo,
  CiStatus,
  Project,
  RepoInfo,
  Selection,
  StatusMap,
} from "./types";

export interface DialogState {
  kind: "prompt" | "confirm";
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  okText?: string;
  danger?: boolean;
  secondaryText?: string;
  onSubmit: (value: string) => void;
  onSecondary?: () => void;
}

interface AppState {
  auth: AuthState | null;
  authLoaded: boolean;
  view: "projects" | "github";
  sel: Selection | null;
  tab: string;
  groupBy: "repo" | "status" | "ci";
  projects: Project[];
  expanded: Record<string, boolean>;
  myRepos: RepoInfo[] | null;
  ci: Record<string, CiStatus>;
  statusMaps: Record<string, StatusMap>;
  cloneProgress: string | null;
  toastMsg: string;
  dialog: DialogState | null;

  init: () => Promise<void>;
  reloadAuth: () => Promise<void>;
  refreshProjects: (keepSel?: boolean) => Promise<void>;
  refreshMyRepos: () => Promise<void>;
  refreshCi: (project: Project) => Promise<void>;
  refreshStatusMap: (co: CheckoutInfo) => Promise<void>;
  setView: (v: "projects" | "github") => void;
  setSel: (s: Selection | null) => void;
  setTab: (t: string) => void;
  setGroupBy: (g: "repo" | "status" | "ci") => void;
  toggleProject: (pid: string) => void;
  setCloneProgress: (s: string | null) => void;
  toast: (msg: string) => void;
  openDialog: (d: DialogState) => void;
  closeDialog: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<AppState>((set, get) => ({
  auth: null,
  authLoaded: false,
  view: "projects",
  sel: null,
  tab: "Overview",
  groupBy: "repo",
  projects: [],
  expanded: {},
  myRepos: null,
  ci: {},
  statusMaps: {},
  cloneProgress: null,
  toastMsg: "",
  dialog: null,

  init: async () => {
    await get().reloadAuth();
  },

  reloadAuth: async () => {
    try {
      const auth = await api.authStatus();
      set({ auth, authLoaded: true });
      if (auth.loggedIn) {
        await get().refreshProjects();
        get().refreshMyRepos();
      }
    } catch (e) {
      set({ auth: { loggedIn: false, login: "", name: "", avatarUrl: "", source: "" }, authLoaded: true });
    }
  },

  refreshProjects: async (keepSel = true) => {
    try {
      const projects = await api.listProjects();
      const expanded = { ...get().expanded };
      for (const p of projects) if (!(p.id in expanded)) expanded[p.id] = true;
      set({ projects, expanded });
      const sel = get().sel;
      if (!keepSel || !sel) {
        if (projects.length > 0) set({ sel: { kind: "project", pid: projects[0].id } });
        return;
      }
      // 当前选中失效时回退到项目
      const missing =
        (sel.kind === "checkout" && !findCheckout(projects, sel.cid)) ||
        (sel.kind === "file" && !findCheckout(projects, sel.co)) ||
        (sel.kind === "project" && !projects.some((p) => p.id === sel.pid));
      if (missing) {
        set({ sel: projects.length ? { kind: "project", pid: projects[0].id } : null });
      }
    } catch (e) {
      get().toast(`加载项目失败: ${e}`);
    }
  },

  refreshMyRepos: async () => {
    try {
      const myRepos = await api.listMyRepos();
      set({ myRepos });
    } catch (e) {
      get().toast(`拉取仓库列表失败: ${e}`);
    }
  },

  refreshCi: async (project) => {
    const gh = project.providerIdentity;
    if (!gh) return; // 无 GitHub 身份的项目没有 CI 可查
    for (const co of project.checkouts) {
      try {
        const run = await api.latestRunForBranch(gh.owner, gh.repo, co.branch);
        let s: CiStatus = null;
        if (run) {
          s =
            run.status !== "completed"
              ? "run"
              : run.conclusion === "success"
                ? "ok"
                : "fail";
        }
        set((st) => ({ ci: { ...st.ci, [co.id]: s } }));
      } catch {
        /* 忽略单个分支失败 */
      }
    }
  },

  refreshStatusMap: async (co) => {
    try {
      const m = await api.checkoutStatus(co.path);
      set((st) => ({ statusMaps: { ...st.statusMaps, [co.id]: m } }));
    } catch {
      /* 忽略 */
    }
  },

  setView: (view) => set({ view }),
  setSel: (sel) => set({ sel }),
  setTab: (tab) => set({ tab }),
  setGroupBy: (groupBy) => set({ groupBy }),
  toggleProject: (pid) =>
    set((st) => ({ expanded: { ...st.expanded, [pid]: !st.expanded[pid] } })),
  setCloneProgress: (cloneProgress) => set({ cloneProgress }),
  toast: (msg) => {
    set({ toastMsg: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toastMsg: "" }), 2600);
  },
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}));

export function findCheckout(
  projects: Project[],
  cid: string
): { p: Project; c: CheckoutInfo } | null {
  for (const p of projects)
    for (const c of p.checkouts) if (c.id === cid) return { p, c };
  return null;
}

export function activeCheckout(
  projects: Project[],
  sel: Selection | null
): { p: Project; c: CheckoutInfo } | null {
  if (!sel) return null;
  if (sel.kind === "checkout") return findCheckout(projects, sel.cid);
  if (sel.kind === "file") return findCheckout(projects, sel.co);
  const p = projects.find((x) => x.id === sel.pid);
  const c = p?.checkouts.find((x) => x.isPrimary);
  return p && c ? { p, c } : null;
}
