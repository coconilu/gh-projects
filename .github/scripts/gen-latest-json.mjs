// 生成 Tauri updater 所需的 latest.json（多平台）。
// 用法: node .github/scripts/gen-latest-json.mjs <tag> [artifactsDir]
// 目录约定（publish 任务把各平台 artifact 下载到对应子目录）：
//   <artifactsDir>/windows/*.exe + .exe.sig        -> windows-x86_64
//   <artifactsDir>/macos/*.app.tar.gz + .sig       -> darwin-aarch64
// 输出 latest.json 到 <artifactsDir>/latest.json。
// 两个平台的产物缺一不可：缺任何一个都报错退出，避免发布残缺的 updater manifest。
import fs from "node:fs";
import path from "node:path";

const tag = process.argv[2];
if (!tag) {
	console.error("用法: node gen-latest-json.mjs <tag> [artifactsDir]");
	process.exit(1);
}

const artifactsDir = process.argv[3] ?? "dist-release";
const repo = process.env.GITHUB_REPOSITORY ?? "coconilu/gitgrove";
const version = JSON.parse(fs.readFileSync("app/package.json", "utf8")).version;

/** 在目录里找「安装包 + 同名 .sig」配对；目录不存在视为该平台未构建。 */
function findSignedPair(dir, suffix) {
	if (!fs.existsSync(dir)) return null;
	const files = fs.readdirSync(dir);
	const file = files.find(
		(f) => f.endsWith(suffix) && !f.endsWith(`${suffix}.sig`),
	);
	if (!file) {
		console.error(
			`${dir} 目录存在但找不到 ${suffix} 安装包（构建或上传步骤异常？）`,
		);
		process.exit(1);
	}
	const sigFile = `${file}.sig`;
	if (!files.includes(sigFile)) {
		console.error(
			`未找到签名文件 ${sigFile}（TAURI_SIGNING_PRIVATE_KEY 未生效？）`,
		);
		process.exit(1);
	}
	return {
		file,
		signature: fs.readFileSync(path.join(dir, sigFile), "utf8").trim(),
	};
}

const platforms = {};
const targets = [
	["windows", ".exe", "windows-x86_64"],
	["macos", ".app.tar.gz", "darwin-aarch64"],
];
for (const [dir, suffix, platform] of targets) {
	const pair = findSignedPair(path.join(artifactsDir, dir), suffix);
	if (!pair) {
		console.error(
			`缺少 ${platform} 平台产物（${artifactsDir}/${dir}/ 不存在）`,
		);
		process.exit(1);
	}
	platforms[platform] = {
		signature: pair.signature,
		url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(pair.file)}`,
	};
}

const latest = {
	version,
	notes: `GitGrove ${tag}`,
	pub_date: new Date().toISOString(),
	platforms,
};

const out = path.join(artifactsDir, "latest.json");
fs.writeFileSync(out, JSON.stringify(latest, null, 2));
console.log(`已生成 ${out}（平台：${Object.keys(platforms).join(", ")}）`);
