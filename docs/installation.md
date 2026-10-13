# 安装与首次使用

## 用户安装

需要 Node.js 22.12+ 和已有的 Codex CLI。本次实际验证为 Node.js 22.16.0、npm 10.9.2、Codex CLI 0.159.2。Mindweave 使用当前 Codex agent 整理，不需要另一个模型 API 密钥。

一次安装：

```bash
npm install -g https://github.com/tracyxiong1/mind-weave/raw/refs/heads/codex/first-canvas-prototype/releases/mind-weave-0.2.0.tgz
```

也可先[下载安装包](https://github.com/tracyxiong1/mind-weave/raw/refs/heads/codex/first-canvas-prototype/releases/mind-weave-0.2.0.tgz)，再运行 `npm install -g <下载文件的路径>`。这是 GitHub 分支上的预先打包版本，尚未发布到 npm registry；不能直接用 `npm install -g mind-weave` 代替。

安装包已包含 CLI、画布页面和 skill，不需要下载源码、安装开发依赖或运行开发服务器。安装会配置用户级 `$mindweave` skill：默认在 `~/.agents/skills/mindweave`；设置了 CODEX_HOME 时使用其 `skills/mindweave`。skill 使用记录的安装路径调用 CLI，避免依赖 Codex 进程是否刷新了 PATH。

如果 npm 默认全局目录没有写权限，可用用户目录安装（macOS/Linux）：

```bash
npm install -g --prefix "$HOME/.local" https://github.com/tracyxiong1/mind-weave/raw/refs/heads/codex/first-canvas-prototype/releases/mind-weave-0.2.0.tgz
```

skill 仍会自动配置；终端里手动调用 `mindweave` 时，该目录的 `bin` 需要在 PATH 中。Windows 使用 npm 配置的用户级全局目录。本次安装验收覆盖 Linux 和含空格的安装路径，尚未进行真实 macOS/Windows 验收。

## 在自己的项目中使用

安装后，在任意项目的 Codex 对话中请求：

```text
$mindweave 整理当前对话并打开画布
```

首次主动整理会读取当前会话可访问的历史文本，不会扫描项目中的其他会话、代码或 Git。安装本身不回溯历史，也不启动预览。画布与私人运行数据默认保存在 `~/.mindweave/`，不向存量项目写入文件。

查看画布时服务自动启动，后续复用同一服务；CLI 返回带当前画布访问凭据的链接，由 Codex 打开或由用户点击。编辑保存后复制节点引用，粘贴回 Codex 并提出问题，skill 会读取最新人工内容。再次请求整理会保留人工字段、位置、删除和合并记录。

只更新数据：`$mindweave 更新当前画布`。每轮自动整理和原生 `@` 补全尚未提供。

## 配置与恢复

- npm 禁用了安装脚本时，安装完成后运行 `mindweave setup` 配置 skill。skill 未显示时可在新对话中检查；`mindweave setup` 会给出实际文件位置。
- 已有自定义或改过的同名 skill 会保留，不自动覆盖。明确替换时用 `mindweave setup --force`，原目录先备份到 Mindweave 运行目录的 `backups/`，不删除备份。
- `mindweave stop` 停止本地服务，保留所有画布；下次查看时重新启动。数据与服务目录可通过 `MINDWEAVE_HOME` 指定，skill 的父目录可通过 `MINDWEAVE_SKILLS_DIR` 指定。
- 在 Devbox 中使用时，安装和存储位于 Devbox；仍需转发服务返回链接中的端口，或设置固定 `MINDWEAVE_PORT` 并转发它。使用 `mindweave open --url http://localhost:转发端口` 返回用户侧地址。自动启动服务不会自动设置 SSH 转发。
- 原型开发仓库中的旧 `.mindweave/` 仍保留；安装版默认用户目录是独立存储，不自动搬移开发数据。首次重新整理同一真实会话前，应先导出需要保留的旧画布人工修改。

## 开发与制作安装包

源代码开发仍使用 `npm ci`、`npm run dev` 和 `npm run mindweave -- COMMAND`。repo skill 的统一启动脚本自动找到源码入口；它不会冒用用户级安装配置。

```bash
npm run check
npm run test:e2e
npm run test:install
```

`test:install` 会构建、打包并在隔离的全局前缀中安装，然后验证一个已有 Git 项目的首次捕获、独立存储、服务并发启动/复用、画布人工修改、再次整理保护、引用回读、停止/重启和项目文件保持。默认用合成会话；设置 `MINDWEAVE_TEST_REAL_CODEX=1` 额外核对本机 Codex 的真实 skill 发现，不运行模型。

`npm pack` 通过 prepare 构建 CLI 和页面，包内只包含运行产物、skill、许可证与说明；没有开发源码、测试、Git 元数据或真实对话。输出例如 `mind-weave-0.2.0.tgz`。本次分发包放在 `releases/`；版本升级时重新生成与验收，再更新下载链接，不把本地测试数据加入包。

全局命令安装遵循 [npm bin 规则](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin)；用户 skill 的发现位置参照 [Codex 官方文档](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)。源码 Git 安装的 prepare 行为见 [npm install 文档](https://docs.npmjs.com/cli/v11/commands/npm-install/)。
