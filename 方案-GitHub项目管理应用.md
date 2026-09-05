# GitHub 项目管理桌面应用 — 产品/技术方案

> 状态：草案 v1 · 2026-09
> 参照竞品：[Orca](https://github.com/stablyai/orca)（本地调研 `C:\Users\admin\Documents\GitHub\orca`）、GitHub Desktop 3.6+、GitKraken
> 关联：已向 Orca 提交 [issue #17180 — My GitHub panel](https://github.com/stablyai/orca/issues/17180)

---

## 1. 定位与机会

### 1.1 一句话定位

**一个以"项目 ↔ worktree ↔ issue/PR"关系为主轴的 GitHub 桌面客户端**：管自己的仓库（公开+私有）、clone 到本地、管 worktree 和分支、管 issue/PR/Actions，Win + Mac 双平台。

### 1.2 为什么是空白（现状盘点）

| 产品 | clone(含私有) | worktree | issue/PR | Actions | 开源 | 双平台 |
|---|---|---|---|---|---|---|
| GitHub Desktop 3.6+ | ✅ | ✅(3.6 新增) | ✅ 基础 | ❌ 只看 check 状态 | ✅ | ✅ |
| GitKraken | ✅ | ✅ | ✅ | 弱 | ❌ 私有仓库收费 | ✅ |
| Orca | ⚠️ 添加本地目录 | ✅ 最强 | ✅ 多源表格 | ❌ | ✅ | ✅+Linux |
| worktree 专用工具(grovr 等) | — | ✅ | ❌ | ❌ | ✅ | 多为 Mac |

结论：GitHub Desktop 功能最接近但 worktree 是配角、Actions 缺位；Orca 的 worktree/任务管理最强但定位是 AI agent 编排器，且"从 GitHub 账号到我的项目"这条路是断的（正是 issue #17180 要补的）。**"GitHub 账号 → 仓库 → 本地 clone → worktree/分支 → issue/PR/Actions"全链路在一个应用里闭环，目前没人做。**

### 1.3 目标用户

- 同时维护多个 GitHub 仓库的个人开发者/独立开发者；
- 重度使用 worktree 并行开发（手工或配合 AI coding agent）；
- 不想在"终端 + GitHub 网页 + GitHub Desktop"三处来回切换的人。

---

## 2. 竞品参照：Orca 可借鉴的设计

基于对 Orca 源码的调研，以下三点直接可学：

### 2.1 数据模型：三层而非两层

Orca 的概念是 **Project（逻辑项目）→ Repo（物理 checkout）→ Worktree（workspace）**：

- `Repo`（`src/shared/repo-types.ts`）：一次具体 clone，含 `path`、`upstream`（fork 来源）、`badgeColor`、`repoIcon`；
- `Project`（`src/shared/project-types.ts`）：逻辑聚合层，含 `providerIdentity: {provider, owner, repo}` 和 `sourceRepoIds[]`；
- `Worktree`（`src/shared/worktree/types.ts`）：`id = ${repoId}::${path}`，关键是有 **`linkedIssue` / `linkedPR` / `linkedWorkItem`** 字段槽，把 worktree 和 GitHub 工作项持久化关联起来。

**借鉴点**：worktree 与 issue/PR 的关联是数据模型层的一等公民，不是 UI 层的临时状态。我们的应用应从一开始就设计 `linkedWorkItem: {type: 'issue'|'pr', number, title, url}`。

### 2.2 侧栏：打平投影 + 虚拟滚动，而非树组件

Orca 侧栏（`src/renderer/src/components/sidebar/`）**不用树形组件**，而是 `buildRows()` 把 worktree 集合投影成扁平 `Row[]`（`GroupHeaderRow` / `WorktreeRow`），再交给虚拟滚动渲染。分组模式可切换：`按 repo | 按看板状态 | 按 PR 状态`。

**借鉴点**：投影成 Row 列表对性能友好、便于多分组模式切换、拖拽排序实现简单。树组件在 worktree 数量多时（20+）会很痛苦。

### 2.3 "从 issue 打开 worktree"的闭环

Orca 的实现（`task-page/hooks/use-task-page-use-item-actions.ts`）：

1. 点击 issue/PR → 先查有没有已关联的 worktree；
2. 有 → 直接激活跳转；
3. 没有 → 打开新建向导，预填名称、关联 workItem，PR 场景还会先算出 base 分支和 head SHA。

**借鉴点**：这是整个产品最顺滑的一条链路，必须原样保留。

### 2.4 Orca 没做好/没做的（我们的差异化）

- "GitHub 账号 → 我的仓库列表 → 一键 clone 成项目"是断的（issue #17180 正是补这个，且官方还没合并）；
- Actions 完全没有；
- 定位是 agent 编排器，对"纯管项目"的用户来说太重（终端、agent、SSH、移动端都是负担）。

---

## 3. 产品需求

### 3.1 功能清单（MoSCoW）

**Must（MVP）**

- GitHub 登录：OAuth device flow（配了 client id 时）+ PAT 兜底；token 加密存主进程/系统 keychain，不出渲染进程
- **My Repos 面板**：列出自己全部仓库（含私有），按最近活动排序，客户端搜索过滤
- 一键 clone 到约定目录（如 `~/gh-projects/<owner>__<repo>/`），clone 完成自动注册为项目；同名目录存在时明确报错
- 支持 clone 任意他人仓库（粘贴 URL / 从搜索）
- 项目内：分支列表（本地/远程）、checkout、新建分支
- 项目内：worktree 列表、新建/删除/锁定、在编辑器/终端/文件管理器中打开
- issue 列表 + 详情（评论、label、assignee）、新建 issue
- PR 列表 + 详情（diff 概览、review 状态、checks 状态）、从 PR 创建 worktree 做本地 review
- **从 issue/PR 一键开 worktree**（含已有 worktree 的直接跳转）

**Should（v1.x）**

- Actions 面板：workflow 列表、run 历史、状态徽章、查看日志、手动 dispatch、rerun/cancel
- fork 关系识别：自己的 fork 显示 upstream，PR 默认提到 upstream
- worktree 与分支状态的实时刷新（文件系统 watcher + `git fetch` 轮询）
- 通知：checks 失败、PR 被 review、CI 完成

**Could（v2）**

- GitHub Projects 看板视图
- Release 管理
- 多账号切换

**Won't（明确不做，避免变成 Orca）**

- 内置终端 / 代码编辑器 / AI agent 编排
- SSH 远程主机、移动端

### 3.2 核心用户旅程

1. 首次打开 → 登录 GitHub → My Repos 列表 → 点 clone → 自动成为项目并展开侧栏；
2. 侧栏点项目 → 详情页看 issues → 点某 issue 的「开 worktree」→ 自动建分支 `fix/123-xxx` + worktree → 在编辑器打开；
3. 改完 → 回应用 → worktree 卡片上直接 commit/push → 创建 PR（自动关联 issue）→ PR 卡片上看 checks → 合并 → 提示清理 worktree。

---

## 4. UI 设计（重点）：项目与 worktree 的关系如何展示

### 4.1 总体布局：三栏

```
┌──────────────────────────────────────────────────────────────┐
│ 侧栏 ~300px       │ 主内容区（项目详情）        │ 文件树 panel     │
│                  │                            │ （最右侧，选中    │
│ [My GitHub]      │  Overview/Branches/        │  checkout 的目录）│
│ [Projects]       │  Worktrees/Issues/         │                │
│  ▼ repo-a        │  Pull Requests/Actions     │  ⌂ repo-a/main │
│    ⌂ main        │  （点文件行则为文件预览）     │  ▼ 📁 src       │
│    ⎇ fix/123     │                            │  📄 package.json│
│    ⎇ feat/x      │                            │  📄 README.md  │
│  ▸ repo-b        │                            │                │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 侧栏：项目 → checkout 两级；文件树在最右侧独立 panel（v1.2 修订）

**层级模型**：repo 下是一个 **checkout 列表**——**第一项固定是原仓库主 clone（非 worktree，标记 `primary`），其余都是 worktree**。两者在 UI 上是同级条目、同等能力，仅 badge 不同。

**文件树不内联在侧栏**（v1.1 的内联方案已放弃：侧栏太窄、挤压 checkout 列表），而是**与 Orca 一致——独立 panel 放在窗口最右侧**：选中任意 checkout（含原仓库），右 panel 即展示该目录的文件树；选中项目时默认展示其主 clone 的文件树。这与 Orca 的 `right-sidebar/file-explorer-*`（每 workspace 一个文件浏览器）形态相同。

实现上侧栏仍是打平的虚拟化行列表（借鉴 Orca `buildRows`），右 panel 的文件树独立渲染、懒加载。

**项目头（GroupHeaderRow）元素**：
- 项目色点 + 图标（自动生成 identicon 或 repo 语言色）、名称
- 右侧：GitHub 链接、星标/私有锁图标、checkout 计数、未读/CI 失败角标
- 折叠态下显示聚合状态（如"1 个 CI 失败"红点）

**checkout 条目（原仓库 + worktree 同一组件，两行结构）**：
- 第一行：⌂（原仓库）/ ⎇（worktree）图标 + 分支名 + `primary` 徽章（仅原仓库）+ hover 快捷操作（编辑器 / 终端 / 删除——主 clone 无删除项）
- 第二行徽标：关联的 `#issue` / `!PR`（点击直达）、CI checks 状态点（绿/黄/红）、与 base 分支的 ahead/behind（↑2↓1）
- 未读高亮（CI 完成、PR 被 review 后左侧色条 + 加粗）

**右侧文件树 panel**：
- 头部：checkout 名（`repo / branch`）、路径、checks 摘要、快捷操作按钮（编辑器/终端/创建 PR/删除）
- 文件树：懒加载（展开目录才 `readDir`），`.gitignore` 目录灰显，文件行带 M/A/D git status 角标
- 文件行交互：单击预览（主内容区）、双击编辑器打开、右键（复制路径 / 在文件管理器显示）
- 展开状态按 checkout 持久化，重开应用后恢复

**分组切换**：顶部可切换 `按项目 | 按状态(进行中/待review/待合并) | 按 CI 状态` 三种泳道——这是打平投影方案的免费午餐，且与右 panel 文件树正交（任何分组模式下点 checkout 都能看文件）。

**为什么侧栏不用真树组件**：打平 Row + 虚拟滚动在 100+ checkout 时依然流畅，分组模式切换只是换投影函数；文件树独立成 panel 后，侧栏只剩两级，更不需要树组件了。

### 4.3 项目详情页：Tabs

点项目头进入详情页，tabs：**Overview | Worktrees & Branches | Issues | Pull Requests | Actions**

- **Overview**：README 渲染 + 关键数字（open issues/PRs、最近 CI 状态、worktree 计数）
- **Worktrees & Branches**：双栏——左 worktree 卡片列表（可新建/锁定/删除/打开），右分支列表（本地/远程分组，显示 ahead/behind、最后提交、可 checkout 成新 worktree）
- **Issues / PRs**：表格（借鉴 Orca 的 `github-work-item-table`：sticky 编号+标题列、label、assignee、checks、review 状态、merge 状态），行内快捷按钮「开 worktree」
- **Actions**：左 workflow 列表（名称+最近状态徽章），右选中 workflow 的 run 历史（状态、分支、触发者、耗时、可点开日志/rerun/cancel）

### 4.4 worktree ↔ issue/PR 关联的视觉表达

这是产品的灵魂，三处体现：

1. **侧栏 worktree 条目**：`#123` 徽章直接挂在分支名下方；
2. **Issues/PRs 表格**：已有关联 worktree 的行显示 `⎇ fix/123-x` 徽章，点击跳转而非新建；
3. **文件树 panel 头部**：显示当前 checkout 关联 issue/PR 徽章、checks 摘要，和"创建 PR"按钮（自动填 `Closes #123`）。

### 4.5 关键交互细节

- **clone 位置约定**：默认 `~/gh-projects/<repo>/`，worktree 默认落在 `<repo>.worktrees/<branch-slug>/` 作为兄弟目录（与主 clone 分离，避免污染项目目录）；可在设置中改
- **clone 冲突**：目标目录已存在 → 明确报错并给出"添加为已有项目"选项，不让 git 裸失败
- **删除**：worktree 两档——从应用移除（文件保留）/ 删除并移入回收站（`shell.trashItem` / Tauri 等价 API，主进程二次确认路径在约定目录内才执行）；原仓库主 clone 不提供"删除 worktree"，只有"移除项目"（可选保留/回收文件）
- **空状态**：未登录 → 登录引导；无项目 → "从 My Repos clone"引导卡
- **暗色优先**，遵循 GitHub Primer 设计语言（让用户感觉"这就是 GitHub"）

---

## 5. 技术方案

### 5.1 技术栈选型

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Tauri 2 + React + shadcn** | 包体积小、Rust 后端适合 git 子进程管理、双平台成熟 | 生态比 Electron 小 | ✅ **推荐**（同类新工具 heroi/zootree 都用它） |
| Electron + React | 可大量参考 Orca 代码、生态最熟 | 包大、内存高 | 备选（若想直接 fork Orca 思路则选它） |

- 前端：React 19 + Tailwind 4 + shadcn/ui + zustand（单一 store + slice，同 Orca 模式）
- 侧栏列表：虚拟滚动（`@tanstack/virtual`）
- Git 操作：**直接调用户的 git 二进制**（兼容性好，GitHub Desktop 也这么做），不绑 libgit2/git2-rs（worktree 支持坑多）
- GitHub API：Octokit（REST + GraphQL 混合：列表用 GraphQL 一次拿全字段省 rate limit，mutation 用 REST）

### 5.2 进程/模块划分

```
src/                    # React 渲染层
  components/
    sidebar/            # 侧栏：buildRows 投影 + 虚拟列表
    repo-detail/        # 项目详情 tabs
    work-items/         # issue/PR 表格 + 详情
    actions-panel/      # Actions 面板
  store/                # zustand slices: repos / worktrees / github / ui

src-tauri/              # Rust 主进程
  src/
    git/                # git 命令封装（clone/worktree/branch/status）
    github/             # API client + 认证 + 缓存
    fs/                 # readDir（懒加载文件树）、文件预览、trashItem 回收站删除
    watcher/            # 文件系统 watcher（.git 目录 + 已展开目录）+ fetch 调度
    store/              # 项目/worktree 元数据持久化（sqlite 或 json）
```

原则（学 Orca AGENTS.md 的教训）：**git/网络/文件操作全在主进程**，渲染层只发命令收事件；Windows 子进程必须 `windowsHide`、不弹窗。

### 5.3 数据模型（核心）

```ts
interface Project {
  id: string;
  providerIdentity: { provider: 'github'; owner: string; repo: string } | null; // 本地/非 GitHub 仓库为 null
  upstream?: { owner: string; repo: string };   // fork 来源
  localPath: string;                             // 主 clone 路径
  badgeColor: string;
  addedAt: number;
}

// providerIdentity 可选：任意 git 仓库（无 origin、GitLab/Gitee 等）都可注册为项目，
// GitHub 相关 tab（Issues/PR/Actions）降级为空状态，本地 git 功能不受影响；
// provider 字段预留 'github' 之外的值（如 'gitlab'）

// 原仓库主 clone 与 worktree 统一建模为 Checkout，UI 同一组件渲染，仅 isPrimary 区分
interface Checkout {
  id: string;                    // `${projectId}::${path}`
  projectId: string;
  path: string;
  branch: string;
  isPrimary: boolean;            // true = 原仓库主 clone（非 worktree，固定排第一）
  isLocked: boolean;
  linkedWorkItem?: {             // 灵魂字段
    type: 'issue' | 'pr';
    number: number;
    title: string;
    url: string;
  } | null;
  createdAt: number;
}

// GitHub 侧数据不进本地库，走缓存 + 刷新策略：
// issues/PRs: 每 60s + 手动刷新；checks: 跟随 PR 刷新；Actions runs: 打开面板时 + 轮询运行中的 run
```

### 5.4 认证与安全

- 首选 **OAuth device flow**（自建 GitHub App / OAuth App 配 client id；开源应用可让用户可选填自己的 client id）
- 兜底 **PAT**：引导用户生成 `repo + workflow` scope 的 fine-grained token
- 存储：系统 keychain（macOS Keychain / Windows DPAPI，Tauri 有 `tauri-plugin-stronghold` 或直接 `keyring` crate），token 永不进渲染层 JS 上下文
- rate limit：列表类请求用 GraphQL 聚合；轮询只针对"运行中"的 checks/runs；退避策略

### 5.5 双平台注意点

- 路径：`path` 处理一律平台无关 API，UI 显示按平台格式化
- 快捷键：`CmdOrCtrl` 统一，UI 上 Mac 显示 `⌘`、Win 显示 `Ctrl`
- 删除走系统回收站，文案按平台区分（回收站/废纸篓）
- Windows：所有子进程 `windowsHide`；签名问题后期用 SignPath（免费给开源项目，Orca 就是这么解决的）
- 发布：GitHub Actions 矩阵构建（macOS arm64/x64 签名公证 + Windows x64 签名），tap-到-release 自动更新（`tauri-plugin-updater`）

---

## 6. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M1 骨架** | Tauri 工程、登录(device flow+PAT)、My Repos 列表、clone 成项目、侧栏项目分组 | 能登录并 clone 一个私有仓库进侧栏 |
| **M2 worktree** | worktree/分支 CRUD、侧栏两级打平投影+虚拟滚动、右侧文件树 panel（懒加载 + git status 角标 + 文件预览）、编辑器/终端打开、回收站删除 | 一个项目 5 个 checkout 并行，点任意 checkout 右侧即出文件树，侧栏流畅 |
| **M3 GitHub 闭环** | issue/PR 表格+详情、从 issue/PR 开 worktree（含跳转已有）、linkedWorkItem 关联展示 | 完成 §3.2 旅程 2-3 |
| **M4 Actions** | workflow/run 面板、日志、dispatch/rerun、CI 状态下沉到侧栏 badge | 不开网页管理一次 CI 失败重跑 |
| **M5 打磨发布** | 通知、设置、自动更新、双平台签名打包、官网 landing | v1.0 release |

M1-M3 是最小可发布产品（已经比 GitHub Desktop 在 worktree 维度强）；M4 完成后形成对 GitHub Desktop 的完整差异化。

---

## 7. 风险与开放问题

1. **GitHub rate limit**：未认证的 5000 req/h 很容易在"50 个仓库 × 轮询"下打爆 → 必须 GraphQL 聚合 + 智能轮询，M3 前做一次实测；
2. **与 Orca 的关系**：#17180 如果被官方合并，Orca 会覆盖我们 60% 的场景 → 差异化押注在"轻量（无 agent/终端）+ Actions + 纯 GitHub 心智"；
3. **OAuth client id**：开源应用内置 client id 有被滥用风险 → 提供"默认内置 + 用户可换自己的"双轨；
4. **worktree 目录组织**：放项目内还是兄弟目录，用户习惯分裂 → 默认兄弟目录 + 设置项，不做强制。
