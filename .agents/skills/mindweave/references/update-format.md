# 整理 JSON 格式

CLI 校验是权威入口；源码类型定义为仓库中的 `src/integration/types.ts`。

```json
{
  "schemaVersion": 1,
  "id": "update-UNIQUE-ID",
  "canvasId": "mw-codex-THREAD-ID",
  "sessionId": "THREAD-ID",
  "baseRevision": 1,
  "nodes": [
    {
      "id": "stable-topic-id",
      "title": "主题标题",
      "summary": "必要的一行摘要",
      "details": "按需展开的解释，区分事实、历史状态和疑问。",
      "kind": "discussion",
      "sources": [{ "messageId": "FROM-CAPTURE", "quote": "原文中的连续逐字摘录" }],
      "position": { "x": 0, "y": 150, "pinned": false }
    }
  ],
  "edges": [{ "id": "stable-edge-id", "from": "stable-topic-id", "to": "ANOTHER-EXISTING-NODE", "label": "关系说明" }]
}
```

上面的占位值不是可应用的数据，必须用 capture 的真实身份和消息替换。

- `canvasId`、`sessionId`、`baseRevision` 分别取 `document.id`、`document.sessionId`、`document.generated.revision`。一次更新最多 100 个节点和 200 条关系；节点至少一个。
- ID 允许字母、数字、`-`、`_`，长度不超过 100，不能是 `constructor`、`prototype` 或 `__proto__`。复用旧主题的 ID，不能用旧关系 ID 指向另一对节点。
- `title` 非空且不超过 120 字符；`summary` 不超过 500；`details` 不超过 10000；关系 `label` 不超过 200。短摘要优先，避免全文堆积。
- `kind` 是 `discussion` 或 `suggestion`。每个 discussion 节点至少一个真实来源；suggestion 可无来源，并明确这是尚未讨论的方向。生成层不能写入用户笔记。
- 来源是 `conversation.messages` 中的消息 ID 和精确连续 `quote`。可选 `start` 是 JavaScript UTF-16 字符索引；摘录多次出现时应填写目标位置。CLI 自动计算稳定 source ID 和 end，校验摘录一致，拒绝假来源。旧节点来源会与新来源合并保留。
- `position` 只对新节点生效，可省略；新位置会避让已有节点。旧节点的人工位置保持不变。
- 这是追加与按 ID 更新接口。省略已有节点或关系不会删除它们，用户删除、移除关系与合并映射仍生效。只发送本轮需要修改或增加的内容。
- 更新整批原子应用。同 ID、同内容重放不增加版本；同 ID 改内容或旧 baseRevision 的新更新被拒绝。更新只修改生成层和新节点初始位置，保留所有人工字段、笔记、关系、删除、合并和撤销记录。
