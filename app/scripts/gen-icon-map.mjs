// 从 material-icon-theme 的 manifest 生成「文件名/扩展名/文件夹名 → 图标 SVG 名」映射模块。
// 用法：node scripts/gen-icon-map.mjs（包升级后重跑）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "node_modules", "material-icon-theme");
const manifest = JSON.parse(
  fs.readFileSync(path.join(pkgDir, "dist", "material-icons.json"), "utf8"),
);

// icon 名 -> svg 文件 basename（不含 .svg）
const svgOf = {};
for (const [name, def] of Object.entries(manifest.iconDefinitions)) {
  svgOf[name] = path.basename(def.iconPath).replace(/\.svg$/, "");
}

const build = (table) => {
  const out = {};
  for (const [key, icon] of Object.entries(table)) {
    const svg = svgOf[icon];
    if (svg && fs.existsSync(path.join(pkgDir, "icons", `${svg}.svg`))) {
      out[key.toLowerCase()] = svg;
    }
  }
  return out;
};

const maps = {
  fileIcons: build(manifest.fileNames),
  extIcons: build(manifest.fileExtensions),
  folderIcons: build(manifest.folderNames),
  folderIconsOpen: build(manifest.folderNamesExpanded),
};
const defaults = {
  defaultFile: svgOf[manifest.file],
  defaultFolder: svgOf[manifest.folder],
  defaultFolderOpen: svgOf[manifest.folderExpanded],
};

const entries = (o) =>
  Object.entries(o)
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    .join(",");

let ts = `// 由 scripts/gen-icon-map.mjs 自动生成，勿手改。值为 material-icon-theme/icons/ 下的 SVG basename。\n`;
for (const [name, map] of Object.entries(maps)) {
  ts += `export const ${name}: Record<string, string> = {${entries(map)}};\n`;
}
for (const [name, v] of Object.entries(defaults)) {
  ts += `export const ${name} = ${JSON.stringify(v)};\n`;
}

const outFile = path.join(root, "src", "generated", "icon-map.ts");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, ts);
console.log(
  `written ${path.relative(root, outFile)}: ${Object.entries(maps).map(([n, m]) => `${n}=${Object.keys(m).length}`).join(" ")}`,
);
