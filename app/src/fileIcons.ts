import {
  defaultFile,
  defaultFolder,
  defaultFolderOpen,
  extIcons,
  fileIcons,
  folderIcons,
  folderIconsOpen,
} from "./generated/icon-map";

// eager + ?url：SVG 作为独立 asset 输出（不进 JS bundle），浏览器只在 <img> 渲染时才加载对应文件
const modules = import.meta.glob<string>("../node_modules/material-icon-theme/icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
const urls: Record<string, string> = {};
for (const [p, u] of Object.entries(modules)) {
  urls[p.slice(p.lastIndexOf("/") + 1, -".svg".length)] = u;
}

export function fileIconUrl(name: string): string {
  const lower = name.toLowerCase();
  let svg = fileIcons[lower];
  if (!svg) {
    // 按最长后缀匹配扩展名（兼容 d.ts / env.local 这类带点 key）
    let i = lower.indexOf(".");
    while (i >= 0) {
      const hit = extIcons[lower.slice(i + 1)];
      if (hit) {
        svg = hit;
        break;
      }
      i = lower.indexOf(".", i + 1);
    }
  }
  return urls[svg ?? defaultFile] ?? urls[defaultFile];
}

export function folderIconUrl(name: string, open: boolean): string {
  const lower = name.toLowerCase();
  const svg = open
    ? (folderIconsOpen[lower] ?? folderIcons[lower] ?? defaultFolderOpen)
    : (folderIcons[lower] ?? defaultFolder);
  return urls[svg] ?? urls[defaultFolder];
}
