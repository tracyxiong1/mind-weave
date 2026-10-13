# 安装与首次使用

## 从 GitHub 安装通用 skill

当前 skill 是自包含的 Agent Skills 目录，内含 CLI、预构建页面、引用格式和许可证。需要 Node.js 22.12+；不需要 npm 全局安装、克隆源码、开发依赖或额外模型 API 密钥。自动读取 Codex 历史时才需要 Codex CLI。

在 Codex 中请求：

```text
$skill-installer 从 tracyxiong1/mind-weave 安装 .agents/skills/mindweave，分支 codex/first-canvas-prototype。
```

当前分支名含 `/`，请分别提供仓库、分支与目录，避免把它误解析为 GitHub 链接中的一级分支。安装器只复制该目录，其所有运行文件都在目录内；安装过程中不执行构建或启动服务。安装后下一轮可以调用 `$mindweave`；未出现时重新启动 Codex。

其他兼容 Agent Skills 的工具可整体复制 `.agents/skills/mindweave` 到其 skill 发现位置。`SKILL.md` 及 scripts/references/assets 是通用部分，`agents/openai.yaml` 是可选的 Codex 展示元数据。运行位置不固定，含空格的路径和移动后的 skill 均可用。

## 整理、预览与回读

在 Codex 中请求：

```text
$mindweave 整理当前对话并打开画布
```

Codex 只读当前会话的完整可访问历史，由当前 agent 提炼图。其他宿主使用 [通用会话 JSON](../.agents/skills/mindweave/references/conversation-format.md)，从实际可访问原文构建输入；它不要求 Codex CLI，也不承诺自动回溯其他宿主的历史。

所有宿主都通过安装目录内的脚本执行：

```bash
node "/实际安装目录/mindweave/scripts/mindweave.mjs" capture --input /会话文件的绝对路径.json
node "/实际安装目录/mindweave/scripts/mindweave.mjs" apply /整理文件的绝对路径.json
node "/实际安装目录/mindweave/scripts/mindweave.mjs" open CANVAS_ID
node "/实际安装目录/mindweave/scripts/mindweave.mjs" read 'mindweave://canvas/CANVAS_ID/node/NODE_ID'
```

用真实路径和 capture 返回的 ID 替换占位值。输入、整理与画布的来源校验见 [skill 操作说明](../.agents/skills/mindweave/SKILL.md)。provider 与 sessionId 联合区分会话，Codex 原有画布 ID 保持兼容。

安装本身不回溯历史、不打开预览。capture/apply 只更新数据；open 按需启动并复用本地服务。打开返回的带凭据链接后即可编辑；复制节点引用给 agent，read 返回最新已保存内容。再次整理保护人工字段、位置、笔记、关系、删除与合并记录。

画布与私人运行数据默认在 `~/.mindweave/`，不写入使用中的项目或 skill 目录。每轮自动整理、其他宿主原生历史适配、原生补全与系统协议尚未提供。

## 可选的 npm CLI 安装

需要终端中的全局 `mindweave` 命令时，也可安装预打包版本：

```bash
npm install -g https://github.com/tracyxiong1/mind-weave/raw/refs/heads/codex/first-canvas-prototype/releases/mind-weave-0.3.0.tgz
```

它会复制完整的用户 skill，默认在 `~/.agents/skills/mindweave`；显式设置 CODEX_HOME 时使用其 skills 目录。安装版 skill 不再依赖机器专属 runtime.json 或原 npm 安装路径。npm 禁用安装脚本时运行 `mindweave setup`。尚未发布到 npm registry，不能直接使用 `npm install -g mind-weave`。

全局目录没有写权限时（macOS/Linux）可用 `--prefix "$HOME/.local"`；skill 不依赖刷新 PATH。终端直接调用 mindweave 需要将该前缀的 bin 加到 PATH。不要同时在多个用户发现目录安装同名 skill，否则可能出现重复选项。

已有自定义或修改过的同名 skill 会保留，安装器拒绝覆盖。npm 的 `mindweave setup --force` 可明确替换并先备份；GitHub 安装器不提供强制覆盖。保留现有内容后再选择安装位置。

## 配置与恢复

- `MINDWEAVE_HOME` 指定数据目录；`stop` 停止本地服务，保留所有画布。新版本查看时会验证并停止不支持通用会话的旧服务，再启动新版，不删除数据。
- Devbox 中安装与存储位于 Devbox，仍需转发服务返回链接中的端口。可用 `MINDWEAVE_PORT` 固定端口，再用 `open CANVAS_ID --url http://localhost:转发端口` 返回用户侧地址；服务不会自动配置 SSH 转发。
- GitHub skill 与 npm skill 默认使用用户数据目录。源码 `npm run mindweave` 仍使用仓库 `.mindweave/`；旧开发数据不自动搬移，切换前可导出需要保留的人工修改。
- 验收覆盖 Linux、Chromium 和含空格的路径；尚未进行真实 macOS/Windows 或其他 agent 的原生历史接口验收。通用 JSON 导入已独立于 Codex 验证。

## 构建与验收

修改 src 或页面后运行 `npm run build:skill`，将更新后的 scripts/runtime 与 assets/web 一起提交，GitHub 安装才会取得匹配的运行文件。`npm pack` 的 prepare 也会同步构建它们，并打包 CLI 与完整 skill。

```bash
npm run check
npm run test:e2e
npm run test:skill
npm run test:install
```

`test:skill` 默认复制独立目录到隔离环境；设置 `MINDWEAVE_SKILL_TEST_REF=提交或分支` 时调用官方 GitHub 安装器直接下载安装，再验证文件/标准输入导入、真实页面编辑、来源回读、再次整理保护、路径移动与存量项目保持。设置 `MINDWEAVE_TEST_REAL_CODEX=1` 额外核对真实 Codex 的 skills/list，不运行模型。安装器位置可通过 MINDWEAVE_SKILL_INSTALLER 指定。

`test:install` 验证 npm 打包、全局命令、自动配置 skill 和原有 Codex 手动闭环。测试全部使用合成对话；私人文件不提交、不进入 skill 或 npm 分发包。

格式与安装说明见 [OpenAI 官方 skill 文档](https://learn.chatgpt.com/docs/build-skills)。
