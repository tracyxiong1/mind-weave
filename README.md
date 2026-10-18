# Mindweave

把零散的对话，编织成可以继续探索的思路。

**Mindweave = mind（思考、心智）+ weave（编织）。** 面向 Codex、Claude 等 agent 的轻量会话画布，保留讨论的主题、联系、来源与未展开的支线。

**当前状态：通用 Agent Skills 安装、会话 JSON 导入与 Codex 手动闭环已实现。** 可在 Codex 中整理真实对话、打开画布、修改节点，再用稳定引用读回最新内容继续讨论。无参数打开仍展示固定样例，无需额外账户、云服务或模型 API 密钥。

## 用户安装

在 Codex 中通过内置安装器安装完整 skill：

```text
$skill-installer 从 tracyxiong1/mind-weave 安装 .agents/skills/mindweave，分支 codex/first-canvas-prototype。
```

然后请求：`$mindweave 整理当前对话并打开画布`。

skill 自带 CLI 和页面，只需要 Node.js 22.12+，无需克隆源码或 npm 安装。自动读取 Codex 历史时另需 Codex CLI；其他兼容 Agent Skills 的工具可安装同一目录，通过通用会话 JSON 导入。不同宿主的原生历史读取尚未提供。

数据默认在 `~/.mindweave/`，查看时服务按需启动，存量项目文件保持原样。需要全局 CLI 时仍可使用 npm 安装包；尚未发布 npm registry。[安装、通用输入与恢复说明](docs/installation.md)。

## 源码开发启动

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

产物在 `dist/`，预览端口为 4173。`npm run preview` 也提供真实画布的本地 API；仅静态托管 `dist/` 无法读取 Codex 文件。内置样例和浏览器草稿按 origin 保存，端口改变后这些缓存的范围也会改变。

## 在 Codex 中使用

GitHub 与 npm 安装版提供完整的用户级 `$mindweave` skill，可在自己的项目中使用；源码仓库内的 repo skill 使用相同预构建入口。请求：

```text
$mindweave 整理当前对话并打开画布
```

Codex 只读捕获当前会话，由当前 agent 提炼带真实来源的节点与关系，再打开本地预览。skill 页面编辑保存到服务机器上的 `~/.mindweave/`；直接运行源码 CLI 的开发模式仍在仓库 `.mindweave/`。后续整理保留人工字段、位置、删除和合并。需要再次整理时请求 `$mindweave 更新当前画布`；它只更新数据。

在节点中复制引用，粘贴回 Codex 并提出问题；skill 先读取最新保存内容，再继续讨论。低层命令为 `npm run mindweave -- capture / apply / open / read / status`，具体参数、Devbox 地址、来源规则与恢复方法见 [Codex 集成说明](docs/codex-integration.md)。实际验证使用 Codex CLI 0.159.2，无需再配置模型 API 密钥；尚未提供每轮自动触发。

## 当前可以做什么

- 在相同布局中查看浅色与深色主题，默认跟随系统；右上角轻量切换。
- 连接较多的讨论节点用字号、底色和摘要突出；折叠支线以标题为主，展开后显示摘要与说明，较长说明可继续展开。
- 平移、缩放、拖动节点；按需展开节点内部的详情与对应对话原文。摘要、补充说明和原文使用不同的文字层次。
- 根据实际节点尺寸自动避让，覆盖展开、原文、编辑和拖动；新增笔记与键盘移动也选择空闲位置。
- 默认沿分支显示主干连线；选中节点时显示全部直接关联并淡化无关内容，右上角可切换“显示全部关联”。所有关系仍保留在数据与“管理关系”中。
- 多个独立分支统一归在会话主题根节点下；已有单一根节点时直接沿用。总主题取自会话标题，作为画布内的汇总入口。
- 通过“整理布局”将当前节点按分支从左到右重新排列，父节点居中、同级对齐，可一步撤销恢复原位置，包括手动移动过的节点。
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

Codex 可通过 `$mindweave` 的 `read` 入口读取真实画布中的稳定引用；内置样例引用用于原型定位。尚未注册操作系统协议或原生 `@` 补全。浏览器无法使用 Clipboard API 时会显示可手工复制的引用。

## 保存位置与范围

**内置样例**保存在当前浏览器、当前 origin 的 localStorage，按画布独立保存，例如：

```text
mindweave:v1:canvas:mw-branches
```

格式版本为 `schemaVersion: 1`。生成节点/关系、人工编辑/笔记/关系/删除记录/合并映射，以及视图位置分别保存；用户只改标题时不会冻结未改过的摘要。撤销使用对应字段的差异记录，不回滚整张图。

内置样例不跨浏览器、设备、域名或端口同步；清理站点数据会丢失内容。容量不足或存储被禁用会明确显示保存失败，当前页面的编辑仍可导出。损坏或未知版本的数据不会被自动覆盖。JSON 导出用于备份，当前没有导入界面。

**导入会话画布**保存在服务机器的运行目录 `canvases/<canvasId>.json`，安装版默认运行目录是 `~/.mindweave/`，开发模式为仓库 `.mindweave/`。浏览器另保留未确认草稿。CLI 读取服务器上最后一次成功保存的人工内容；网络失败时保留草稿并提示。不同浏览器可通过带凭据链接访问同一画布，人工编辑并发冲突会停止覆盖并提供备份恢复。私人运行数据不会打入分发包，导出的真实画布包含对话与摘录。详情见 [保存与冲突规则](docs/codex-integration.md#更新冲突与恢复)。

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
npm run test:e2e   # Chromium 交互、Codex 画布回读、持久化与恢复
npm run test:skill # 独立 skill 安装、通用导入与浏览器闭环
npm run test:install # npm 安装、存量项目首次使用与 Codex 闭环
npm run build:skill # 更新随 GitHub skill 分发的 CLI 和页面
```

浏览器测试优先使用 `/usr/bin/chromium`（若存在），或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定。没有系统 Chromium 时先运行 `npx playwright install chromium`。E2E 会启动 5173 服务或复用当前服务；失败的截图与 trace 在 `test-results/`。明暗和窄视口验收截图在 `docs/validation/`。

## 文档与后续边界

- [产品规则](docs/product.md)
- [实施路线](docs/roadmap.md)
- [版本化数据契约](docs/data-contract.md)
- [概念图](docs/design/README.md)
- [验证记录与截图](docs/validation/README.md)

Codex 集成使用带来源的追加/更新接口，保护人工层并校验重放与过期版本。通用 JSON 输入已独立于 Codex CLI 运行；后续验证其他宿主原生历史读取、完整轮次事件与可选自动整理；原生 `@`、系统协议、多人协作、账户和云同步尚未提供。

源码仓库：[tracyxiong1/mind-weave](https://github.com/tracyxiong1/mind-weave)。保留 [MIT 许可证](LICENSE)。
