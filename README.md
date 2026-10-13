# Mindweave

把零散的对话，编织成可以继续探索的思路。

**Mindweave = mind（思考、心智）+ weave（编织）。** 面向 Codex、Claude 等 agent 的轻量会话画布，保留讨论的主题、联系、来源与未展开的支线。

**当前状态：第一阶段的本地可编辑原型已实现。** 使用确定的示例对话，无需账户、云服务或模型 API 密钥。真实对话接入与自动提炼属于后续阶段。

## 启动

需要 Node.js **22.12 或更新版本**（本次验证为 22.16.0）和 npm。

```bash
npm ci
npm run dev
```

在运行服务的机器上访问 <http://localhost:5173>。服务监听 `0.0.0.0:5173`，端口占用时明确报错，启动不会自动打开浏览器。

如果代码运行在 Devbox，通过现有 SSH 连接转发端口。在你自己电脑的终端运行（将 `你的Devbox主机` 替换为平时 SSH 使用的主机或别名）：

```bash
ssh -N -L 5173:127.0.0.1:5173 你的Devbox主机
```

保持终端连接，在自己电脑的浏览器中打开 <http://localhost:5173>。本机 5173 被占用时，使用 `-L 15173:127.0.0.1:5173`，访问 <http://localhost:15173>。也可以在编辑器的端口面板中转发远端 5173。Devbox 的内网 IP 不一定能从用户浏览器直接访问，本原型没有上线部署。

构建和查看构建产物：

```bash
npm run build
npm run preview
```

产物在 `dist/`，预览端口为 4173。端口改变后浏览器保存数据的范围也会改变。

## 当前可以做什么

- 在相同布局中查看浅色与深色主题，默认跟随系统；右上角轻量切换。
- 连接较多的讨论节点用字号、底色和摘要突出；折叠支线以标题为主，展开后显示摘要与说明，较长说明可继续展开。
- 平移、缩放、拖动节点；按需展开节点内部的详情与示例原文。摘要、补充说明和原文使用不同的文字层次。
- 根据实际节点尺寸自动避让，覆盖展开、原文、编辑和拖动；新增笔记与键盘移动也选择空闲位置。
- 双击修改标题、摘要；通过节点上方的 `…` 新增笔记、连接、管理关系、合并或删除。
- 撤销与重做最近 40 步；刷新后仍能撤销已保存的操作。
- 自动本地保存内容、人工修改、节点位置、展开状态、视口与主题。
- 复制并解析稳定引用；改标题或合并后，原引用仍然有效。
- 导出当前画布 JSON；无法读取的本地数据保留原样，可先下载原数据再恢复示例。

选中节点只改变查看状态。画布没有聊天输入框，也不会修改原对话或发送 agent 消息。AI 建议保持虚线并标记“尚未讨论”；手工内容标为用户笔记，不冒充对话来源。

窄预览保留可读字号，完整图通过平移查看；展开节点会移入当前预览范围。使用说明与保存详情在右上角 `?` 内，不常驻占据画布。

展开内容时的避让是临时展示偏移，保留保存的节点锚点和固定标记；折叠后重新从这些位置排布。拖动落点才会保存为人工位置，并只记一步撤销。连线、适应画布和引用定位都使用避让后的展示坐标。

## 稳定引用

```text
mindweave://canvas/mw-branches/node/comparison
```

身份只依赖画布 ID 和节点 ID。点击右上角“定位引用”，粘贴并定位；也支持在页面 URL 中使用 `#ref=<URL 编码后的引用>`，例如：

<http://localhost:5173/#ref=mindweave%3A%2F%2Fcanvas%2Fmw-branches%2Fnode%2Fcomparison>

纯解析入口是 `src/core/references.ts` 的 `parseReference` 和 `resolveReference`。解析会区分格式错误、其他画布、已删除和不存在的节点。合并的旧 ID 可连续解析到当前节点；删除后不会悄悄跳到其他内容。

这是**本原型内的引用格式与解析能力**。尚未注册操作系统协议，也不声称原 agent 能自动读取、原生 `@` 能补全或宿主能内嵌画布。浏览器无法使用 Clipboard API 时会显示可手工复制的引用。

## 保存位置与范围

当前浏览器、当前 origin 的 **localStorage**，按画布独立保存，例如：

```text
mindweave:v1:canvas:mw-branches
```

格式版本为 `schemaVersion: 1`。生成节点/关系、人工编辑/笔记/关系/删除记录/合并映射，以及视图位置分别保存；用户只改标题时不会冻结未改过的摘要。撤销使用对应字段的差异记录，不回滚整张图。

不跨浏览器、设备、域名或端口同步；清理站点数据会丢失内容。容量不足或存储被禁用会明确显示保存失败，当前页面的编辑仍可导出。损坏或未知版本的数据不会被自动覆盖。JSON 导出用于备份，当前没有导入界面或多标签页同步。

## 样例与键盘

图数据与原始消息分别位于 `src/data/*.graph.json` 和 `src/data/*.conversation.json`。来源以稳定 ID 和消息内范围定位，不生成虚假的宿主跳转链接。

- 默认的[多次分叉样例](http://localhost:5173/?sample=branches)；另有[学习型](http://localhost:5173/?sample=learning)和[方案讨论型](http://localhost:5173/?sample=planning)，各自保存。也可从使用说明中切换。
- `Tab` 切换焦点；节点聚焦后 `Enter` 展开、`F2` 编辑、`Delete` 删除、`Esc` 取消编辑或关闭菜单/对话框。
- `Ctrl / ⌘ + 方向键` 移动节点 10 像素，配合 `Shift` 移动 40 像素。
- 拖动空白、滚动或聚焦画布后用方向键平移；`Ctrl / ⌘ + 滚轮` 缩放。
- `Ctrl / ⌘ + Z` 撤销，配合 `Shift` 重做。

## 开发与验证

React + TypeScript + Vite，HTML 节点与 SVG 连线，无图编辑器或同步框架依赖。依赖版本锁定在 `package-lock.json`。

```bash
npm run check      # 类型检查、数据测试、生产构建
npm run test:e2e   # Chromium 中的真实交互、持久化与恢复测试
```

浏览器测试优先使用 `/usr/bin/chromium`（若存在），或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定。没有系统 Chromium 时先运行 `npx playwright install chromium`。E2E 会启动 5173 服务或复用当前服务；失败的截图与 trace 在 `test-results/`。明暗和窄视口验收截图在 `docs/validation/`。

## 文档与后续边界

- [产品规则](docs/product.md)
- [实施路线](docs/roadmap.md)
- [版本化数据契约](docs/data-contract.md)
- [概念图](docs/design/README.md)
- [验证记录与截图](docs/validation/README.md)

后续实现完整增量应用器、模型提炼、真实 agent 手动闭环，再验证宿主预览、完整轮次事件与可选自动整理。本轮没有提供这些集成，也没有多人协作、账户或云同步。

源码仓库：[tracyxiong1/mind-weave](https://github.com/tracyxiong1/mind-weave)。保留 [MIT 许可证](LICENSE)。
