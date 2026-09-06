# 受保护主分支上的发布

当前默认主分支是 master，版本升级必须通过 PR 和必需的 check。

## 正常发版

1. 在 Actions → Release 从 master 运行，选择 patch、minor 或 major。
2. 流程创建 codex/release-vX.Y.Z 分支和版本 PR 后结束。如果相同版本已有打开的 PR，则复用它，不覆盖分支。
3. 打开版本 PR。若 GitHub 显示 **Approve workflows to run**，先批准运行；等待 check 通过，检查版本号及 CHANGELOG，再合并 PR。
4. 合并后的主分支 CI 成功后触发 Release，构建与发布都固定到该 CI 的提交 SHA。

流程不会直推主分支，也不会绕过保护、自动批准或自动合并 PR。无需开启仓库 auto-merge。

仓库需要启用 Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests**。默认 GITHUB_TOKEN 权限保持 read；仅准备 PR 的任务获得 contents/write 与 pull-requests/write，只有发布任务获得 contents/write。

## 重试与预发布

| 操作 | 行为 |
| --- | --- |
| Release 选择 none | 发布该次手动运行的固定提交；必须是默认分支，且该提交已通过 check |
| 版本已正式发布 | 跳过，避免覆盖用户已经收到的安装包 |
| CI 失败 / 取消 / 跳过 | 不进入自动发布 |
| Issue 以 completed 关闭 | 为事件的固定主分支提交生成 vX.Y.Z-issueN 预发布，仍检查该提交的 check |
| Issue 以 not_planned 关闭 | 不构建预发布 |
| 构建失败 | 不执行发布任务 |
| 上传失败 | 保留草稿，不更新正式版本；可对同一提交重试，tag 不能指向其他提交 |

所有平台产物上传完成后才将 Release 草稿发布。Windows 和 macOS 任一产物或 updater 签名缺失都会报错。预发布不占用 releases/latest 更新源。

没有 check 结果的旧提交，可以先在默认分支手动运行 CI，再用 none 重试。发布签名仍使用既有 TAURI_SIGNING_PRIVATE_KEY 与对应密码 Secret，本次未更换密钥。

## 本地检查

- node --test .github/scripts/*.test.mjs
- pnpm -C app test
- pnpm -C app lint
- pnpm -C app build
- cargo check --manifest-path app/src-tauri/Cargo.toml
- cargo test --manifest-path app/src-tauri/Cargo.toml --lib
- actionlint .github/workflows/ci.yml .github/workflows/release.yml

本地测试与语法检查不等于已验证 GitHub 上的签名构建和发布。合并工作流改动后，应通过下一次正常版本 PR 验证在线发布闭环。

GitHub 当前的 GITHUB_TOKEN 创建 PR 后，PR 工作流可能需要人工批准运行，详见[官方工作流触发说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。
