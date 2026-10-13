# 通用会话输入

`capture --input FILE.json` 接收以下格式；`capture --input -` 接收相同 JSON 的标准输入。通用导入不调用 Codex，不读取其他宿主文件，不需要模型 API 密钥。

```json
{
  "schemaVersion": 1,
  "provider": "generic",
  "sessionId": "stable-session-id",
  "title": "讨论主题",
  "messages": [
    { "id": "message-1", "role": "user", "text": "用户实际提供的原始文本。" },
    { "id": "message-2", "role": "assistant", "text": "实际可访问的回复原文。" }
  ]
}
```

- `provider` 标识来源，例如 `generic`、`claude`、`cursor`。它以小写字母开头，仅含小写字母、数字、连字符，最多 32 字符。相同 sessionId 在不同 provider 下属于不同画布。
- `sessionId` 与消息 `id` 稳定且非空，仅含字母、数字、`-`、`_`，最多 100 字符，不能为 `__proto__`、`constructor` 或 `prototype`。优先使用宿主真实 ID；原始 ID 不符合格式时保留稳定映射。文本导出没有 ID 时可一次性编号，后续沿用。
- `title` 非空，最多 500 字符。消息角色只能是 `user` 或 `assistant`，ID 不重复，text 保留完整可访问原文，不截断、不修改空白或 Unicode。
- 最多 10000 条消息、每条 1000000 字符、输入 JSON 最大 32 MiB。可导入当前可访问片段，但需说明范围，不能声称已回溯不可访问历史。工具输出与系统消息不作为用户/assistant 消息伪装导入。
- 再次导入同一会话会保留旧消息与用户编辑、追加新 ID；相同 ID 的角色或文本变化会拒绝。分叉到不同会话时使用新的 sessionId。
- 输入文件放在用户提供的位置、临时目录或 `~/.mindweave/imports/`，不要写进用户项目。运行输出的 capturePath 是后续引用摘录的依据。

宿主需要支持读取 skill、执行 Node 脚本与访问本地页面。格式兼容不代表自动获取每个宿主的历史；没有历史读取入口时使用显式导入。
