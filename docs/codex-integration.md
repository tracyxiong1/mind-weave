# Codex 手动闭环

2026-10-13 已接通当前 Codex 会话的「整理 → 查看 → 修改 → 再次整理 → 按引用继续讨论」。使用当前 Codex agent 做语义提炼，不需要另一个模型 API 或 API 密钥。原型与这次集成均在 `codex/first-canvas-prototype` 分支。

## 在 Codex 中使用

项目内的 `.agents/skills/mindweave/SKILL.md` 是实际入口。在本项目中可以请求：

```text
$mindweave 整理当前对话并打开画布
$mindweave 更新当前画布
$mindweave 打开当前画布
```

整理和打开是独立操作；第二条只更新数据，不打开浏览器或抢焦点。第一次打开真实画布需要使用 CLI 返回的带访问凭据的预览链接；之后同一浏览器可直接打开对应的 `?canvas=...` 地址。

在画布内展开节点、复制引用，将引用粘贴回原 Codex 对话并提出问题，例如：

```text
$mindweave 基于 mindweave://canvas/CANVAS_ID/node/NODE_ID 的最新修改，继续讨论这个取舍。
```

skill 先读取最新保存的人工内容、来源和关系，再基于它回答。引用不依赖标题；合并前的旧 ID 会解析到保留节点，已删除引用明确报错。原生 `@` 补全和系统协议尚未注册。

## 实际 CLI

先按 README 安装依赖并启动 `npm run dev`。以下命令在项目根目录执行：

```bash
npm run mindweave -- capture
npm run mindweave -- apply .mindweave/updates/FILE.json
npm run mindweave -- open
npm run mindweave -- read 'mindweave://canvas/CANVAS_ID/node/NODE_ID'
npm run mindweave -- status
```

`capture` 默认使用 `CODEX_THREAD_ID`；明确指定另一会话时用 `capture --thread ID`。`open`、`status` 可传画布 ID。Devbox 已转发到其他本地端口时，用 `open --url http://localhost:转发端口`。在当前 Codex 桌面环境中，远端 5173 已有本机 63588 转发；这是当前运行地址，不是固定产品端口。可通过 Codex 的浏览器打开工具打开链接，或手动点击。

`capture` 只读历史和当前用户文本，保存快照并输出 `capturePath`。Codex 根据快照提炼 JSON 后，`apply` 才更新图；CLI 本身没有用关键词或固定规则冒充模型提炼。整理格式见 [skill 格式说明](../.agents/skills/mindweave/references/update-format.md)。

## 数据与来源

| 位置 | 保存内容 |
| --- | --- |
| `.mindweave/canvases/<canvasId>.json` | 权威画布、真实文本、来源、人工修改、视图、撤销记录、访问凭据与更新去重记录 |
| `.mindweave/captures/<canvasId>.json` | 整理时读取的快照，不包含访问凭据；下一次 capture 会更新它 |
| `.mindweave/updates/*.json` | 当前 agent 提炼的增量提案 |
| 浏览器 `mindweave:v1:codex-draft:<canvasId>` | 未确认保存的草稿、基础版本和发送中的文档，用于断线恢复 |

真实画布以运行服务机器上的文件为准；换浏览器需要新的带凭据链接。浏览器草稿不是 Codex 的读取来源：页面显示保存失败时，Codex 仍读到最后一次成功保存的版本。内置 `?sample=...` 样例沿用各自的 localStorage，不与真实会话画布混用。

服务通过 Vite 开发或预览插件提供 `/api/canvases/<id>`。第一次载入验证访问凭据并设置当前画布的 HttpOnly、SameSite cookie，随后从页面 URL 移除凭据。API 不返回凭据和更新去重账本，不提供画布列表；`.mindweave` 禁止通过静态路径访问。私人文件权限为 0600，运行目录已被 Git 忽略。导出真实画布包含对话和摘录，适合个人备份，公开分享前需要自行选择内容。

原始消息只保留用户文本和完整轮次中最终 assistant 回复，忽略 reasoning、工具输出和 commentary。图片不做 OCR；附件路径和环境包装保留在原始文本中以保持可定位范围，整理时将其作为数据而不是指令。来源从精确的消息内摘录计算稳定 ID，采用 UTF-16 范围。发现旧消息被改写时拒绝替换；Codex 历史被压缩或回退后保留此前捕获的原文，以免旧引用失效。

## 更新、冲突与恢复

增量先验证整批，再原子写入。来源不匹配、悬空关系、身份不一致或过旧生成版本会使整批失败；同 ID 同内容重放没有副作用，同 ID 改内容会报错。省略旧节点不会删除它们，更新接口只追加或按稳定 ID 修改生成内容。

人工字段、笔记、关系、删除记录、合并映射和撤销历史独立保存。旧位置不会被生成提案移动；新节点安排到空位，展示继续按实际尺寸避让。浏览器保存采用文件版本检查：与新 Codex 生成内容并发时，保留草稿并重试；遇到另一页面的人工内容或位置修改时，停止自动覆盖并提示备份和重新载入。它提供冲突检测，不是多人实时协作。

页面关闭前尝试发送最后一次保存，同时保留浏览器草稿。网络失败时可继续在已打开页面编辑并导出；重连后刷新或重试恢复草稿。服务完全停止时，重新打开真实画布需要先恢复服务。损坏的服务器文件或浏览器草稿保留原数据，不自动重置。发生冲突时通过使用说明中的「备份并载入最新画布」恢复。

## 核对过的 Codex 接口

实际验证使用 Codex CLI **0.159.2**。适配器启动独立 `codex app-server`，完成 `initialize` 后只发 `thread/read` 与 `thread/turns/list`。分页历史请求 `itemsView: full`，明确拒绝摘要历史，不调用 `thread/resume`、`turn/start` 或其他修改会话操作。缺少 CLI 可设置 `MINDWEAVE_CODEX_BIN` 指向本机二进制。

采用这些接口前已核对 [Codex app-server 官方文档](https://learn.chatgpt.com/docs/app-server)；skill 使用项目 `.agents/skills` 发现机制，见 [官方 skill 文档](https://learn.chatgpt.com/docs/build-skills)。当前环境的 `skills/list` 已确认该 skill 为启用的 repo skill。没有修改全局认证、连接其他账户或注册 MCP。

## 验证结果与边界

- `npm run typecheck`、`npm test`、`npm run build` 和 `npm run test:e2e`：通过。数据/协议/保存测试 57 项，Chromium 交互验收 18 项。
- 本次真实 Codex 会话导入 11 条文本消息，提炼 6 个主题和 5 条关系；逐字核对原文摘录。
- 在真实画布中修改标题、移动节点，复制引用，通过 CLI 读到最新人工修改；再次整理仍保留人工标题与位置，未改摘要更新，刷新保持；随后撤销校验修改恢复原内容。
- 明暗与 480 × 800 窄视口、引用定位检查无页面错误。真实会话截图和回读输出只保存在被 Git 忽略的 `.mindweave/validation/`；公开测试只用合成文本。
- 自动化还覆盖旧版本、重复更新、假的来源、原子失败、并发写入、损坏文件、访问控制、断线恢复、编辑表单期间延迟更新、删除重放、合并旧引用和字段保护。

当前完成 Codex 手动链路；每轮自动触发、Claude 适配、原生 `@`、系统协议、多人协作和云同步仍未实现。构建产物需要 `npm run preview` 提供本地 API；单独静态托管 `dist/` 不能访问 Codex 文件。继续扩展时需要重新验证宿主接口，不能仅凭本文保证未来版本兼容。
