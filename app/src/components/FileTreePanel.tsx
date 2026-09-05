import { useEffect, useState } from "react";
import * as api from "../api";
import { fileIconUrl, folderIconUrl } from "../fileIcons";
import { activeCheckout, useStore } from "../store";
import { LinkBadge } from "./Sidebar";
import { useCoOps } from "./ProjectDetail";
import type { CheckoutInfo, DirEntry, Project } from "../types";

interface Menu {
  x: number;
  y: number;
  absPath: string;
  isDir: boolean;
}

export default function FileTreePanel() {
  const { view, projects, sel, ci, refreshStatusMap, statusMaps, toast } = useStore();
  const hit = activeCheckout(projects, sel);
  const [nodes, setNodes] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);

  const cid = hit?.c.id;
  const coPath = hit?.c.path;

  // 展开状态按 checkout 持久化
  useEffect(() => {
    if (!cid) return;
    try {
      const raw = localStorage.getItem(`gh-projects.expanded.${cid}`);
      setExpanded(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch {
      setExpanded(new Set());
    }
    setNodes({});
    if (coPath) {
      api
        .readDir(coPath)
        .then((list) => setNodes((m) => ({ ...m, "": list })))
        .catch(() => {});
    }
  }, [cid]);

  useEffect(() => {
    if (hit) refreshStatusMap(hit.c);
  }, [cid]);

  if (view === "github")
    return (
      <aside className="ctx">
        <div className="ctx-empty">
          选择仓库后可 clone
          <br />
          到 ~/gh-projects/
        </div>
      </aside>
    );
  if (!hit)
    return (
      <aside className="ctx">
        <div className="ctx-empty">
          选中一个 checkout
          <br />
          查看它的目录文件
        </div>
      </aside>
    );

  const { p, c } = hit;
  const smap = statusMaps[c.id];

  const persist = (s: Set<string>) => {
    setExpanded(s);
    localStorage.setItem(`gh-projects.expanded.${c.id}`, JSON.stringify([...s]));
  };

  const toggleDir = async (rel: string) => {
    const next = new Set(expanded);
    if (next.has(rel)) {
      next.delete(rel);
      persist(next);
      return;
    }
    next.add(rel);
    persist(next);
    if (!nodes[rel]) {
      try {
        const list = await api.readDir(`${c.path}/${rel}`);
        setNodes((m) => ({ ...m, [rel]: list }));
      } catch (e) {
        toast(`读取目录失败: ${e}`);
      }
    }
  };

  const isIgnored = (rel: string, name: string) => {
    if (name === ".git") return true;
    if (!smap) return false;
    return smap.ignored.some((ig) => rel === ig || rel.startsWith(`${ig}/`));
  };

  const changeCode = (rel: string) =>
    smap?.changes.find((ch) => ch.path === rel)?.code ?? null;

  const renderRows = (base: string, depth: number): React.ReactNode => {
    const list = (nodes[base] ?? []).filter((e) => !(depth === 0 && e.name === ".git"));
    return list.map((f) => {
      const rel = base ? `${base}/${f.name}` : f.name;
      const pad = 4 + depth * 16;
      const ignored = isIgnored(rel, f.name);
      const abs = `${c.path}/${rel}`;
      if (f.isDir) {
        const open = expanded.has(rel);
        return (
          <div key={rel}>
            <div
              className={`row file${ignored ? " ignored" : ""}`}
              style={{ paddingLeft: pad }}
              onClick={() => toggleDir(rel)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, absPath: abs, isDir: true });
              }}
            >
              <span className="twisty">{open ? "▼" : "▶"}</span>
              <img className="ficon" src={folderIconUrl(f.name, open)} alt="" draggable={false} />
              <span className="fname">{f.name}</span>
            </div>
            {open && renderRows(rel, depth + 1)}
          </div>
        );
      }
      const gs = changeCode(rel);
      const key = `${c.id}/${rel}`;
      const seld = sel?.kind === "file" && sel.key === key;
      return (
        <div
          key={rel}
          className={`row file${ignored ? " ignored" : ""}${seld ? " sel" : ""}`}
          style={{ paddingLeft: pad }}
          onClick={() => useStore.getState().setSel({ kind: "file", key, co: c.id })}
          onDoubleClick={() => api.openInEditor(abs).catch((e) => toast(`${e}`))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, absPath: abs, isDir: false });
          }}
        >
          <span className="twisty"></span>
          <img className="ficon" src={fileIconUrl(f.name)} alt="" draggable={false} />
          <span className="fname">{f.name}</span>
          {gs && <span className={`gs ${gs}`}>{gs}</span>}
        </div>
      );
    });
  };

  return (
    <aside className="ctx" onClick={() => menu && setMenu(null)}>
      <CtxHead p={p} c={c} ci={ci[c.id]} />
      <div className="ctx-tree">{renderRows("", 0)}</div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            onClick={() => {
              navigator.clipboard.writeText(menu.absPath);
              setMenu(null);
              toast("已复制路径");
            }}
          >
            复制路径
          </button>
          <button
            onClick={() => {
              api.revealInExplorer(menu.absPath).catch((e) => toast(`${e}`));
              setMenu(null);
            }}
          >
            在文件管理器显示
          </button>
          {!menu.isDir && (
            <button
              onClick={() => {
                api.openInEditor(menu.absPath).catch((e) => toast(`${e}`));
                setMenu(null);
              }}
            >
              在编辑器打开
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

function CtxHead({
  p,
  c,
  ci,
}: {
  p: Project;
  c: CheckoutInfo;
  ci: string | null | undefined;
}) {
  const ops = useCoOps(p);
  return (
    <div className="ctx-head">
      <h3>
        {c.isPrimary ? "⌂" : "⎇"} {p.name} / {c.branch}{" "}
        {c.isPrimary && <span className="badge b-primary">primary</span>}
      </h3>
      <div className="path">{c.path}</div>
      <div className="check-row" style={{ flexWrap: "wrap" }}>
        <LinkBadge link={c.linkedWorkItem} />
        {ci && (
          <>
            <span className={`ci ${ci}`} />
            <span style={{ color: "var(--muted)" }}>CI</span>
          </>
        )}
      </div>
      <div className="ops">
        <button className="btn sm" onClick={() => ops.openEditor(c)}>编辑器</button>
        <button className="btn sm" onClick={() => ops.openTerm(c)}>终端</button>
        {!c.isPrimary && p.providerIdentity && (
          <button className="btn sm primary" onClick={() => ops.createPr(c)}>创建 PR</button>
        )}
        {!c.isPrimary && (
          <button className="btn sm danger" onClick={() => ops.del(c)}>删除</button>
        )}
      </div>
    </div>
  );
}
