import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const branch = event.repository.default_branch;
if (process.env.GITHUB_REF !== "refs/heads/" + branch)
	throw new Error("请从默认分支准备版本升级");
const run = (command, args) =>
	execFileSync(command, args, { encoding: "utf8" }).trim();
run("node", [".github/scripts/bump-version.mjs", process.env.BUMP]);
const version = JSON.parse(readFileSync("app/package.json", "utf8")).version;
const head = "codex/release-v" + version;
const existing = JSON.parse(
	run("gh", [
		"pr",
		"list",
		"--repo",
		process.env.GITHUB_REPOSITORY,
		"--base",
		branch,
		"--head",
		head,
		"--state",
		"open",
		"--json",
		"url",
	]),
);
let url = existing[0]?.url;
if (!url) {
	if (run("git", ["ls-remote", "--heads", "origin", "refs/heads/" + head]))
		throw new Error(head + " 已存在但没有打开的 PR，请检查该分支后再重试");
	run("git", ["config", "user.name", "github-actions[bot]"]);
	run("git", [
		"config",
		"user.email",
		"41898282+github-actions[bot]@users.noreply.github.com",
	]);
	run("git", ["switch", "-c", head]);
	run("git", [
		"add",
		"app/package.json",
		"app/src-tauri/tauri.conf.json",
		"CHANGELOG.md",
	]);
	run("git", ["commit", "-m", "chore: release v" + version]);
	run("git", ["push", "-u", "origin", head]);
	const body = join(tmpdir(), "gitgrove-release-pr.md");
	writeFileSync(
		body,
		"升级到 v" +
			version +
			"，同步版本号与变更记录。\n\n" +
			"- [ ] 如 GitHub 提示待批准，在 PR 中点击 Approve workflows to run\n" +
			"- [ ] 等待必需 check 通过并完成审查\n" +
			"- [ ] 合并 PR；主分支 CI 成功后自动构建并发布固定提交\n\n" +
			"本流程不直推主分支、不绕过保护、不自动批准或合并。\n",
	);
	url = run("gh", [
		"pr",
		"create",
		"--repo",
		process.env.GITHUB_REPOSITORY,
		"--base",
		branch,
		"--head",
		head,
		"--title",
		"chore: release v" + version,
		"--body-file",
		body,
	]);
}
appendFileSync(
	process.env.GITHUB_STEP_SUMMARY,
	"## 版本升级 PR 已准备\n\n" +
		url +
		"\n\n请批准待运行的 CI（如果显示该提示），检查通过后合并 PR。主分支 CI 成功后会自动发布。此运行只准备 PR。\n",
);
console.log(url);
