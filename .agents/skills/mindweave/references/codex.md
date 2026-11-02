# Codex 适配

在 Codex 中可以用 `$mindweave` 调用本 skill。有当前 `CODEX_THREAD_ID` 时执行 `capture`，用户明确指定会话时可用 `capture --thread ID`；不要改用最近的其他会话。没有当前身份时可用通用会话 JSON，或取得用户明确指定的 ID。

自动读取需要安装 Codex CLI，可用 `MINDWEAVE_CODEX_BIN` 指定其路径。读取只调用 app-server 的 initialize、thread/read 与需要的 thread/turns/list；不恢复会话、不发消息、不运行另一个模型。导入完整可访问历史中的用户文本和完成的最终回复，跳过工具与处理中消息。

Codex 的 provider 为 `codex`，保留既有 `mw-codex-<thread-id>` 画布 ID 与引用。通用导入和不同 provider 的画布不会覆盖它。安装本 skill 不回溯历史、不启动预览。

仅整理时使用 capture 与 apply；只有请求查看时才 open。可以指定 `MINDWEAVE_PORT` 固定服务端口，并在 Devbox 转发到用户机器的 localhost 地址。
