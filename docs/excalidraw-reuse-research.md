# Excalidraw 复用可行性调研

调研日期：2026-11-02。范围：Mindweave 会话画布与开源 `@excalidraw/excalidraw`。本文保留初始调研的判断和待验证项。后续已完成独立原型并按用户决定迁移默认画布，最终采用原生场景与 HTML 阅读层；当前实现与验收见[迁移报告](validation/excalidraw/README.md)，早期实验结果见[原型记录](validation/excalidraw/prototype.md)。下文“待验证”和采用建议均属于初始调研时点。

## 一、结论

Excalidraw 可以复用为画布编辑组件。当前项目的主要适配成本集中在可展开阅读卡片、业务操作回写和撤销一致性。建议先验证 `embeddable + renderEmbeddable` 能否承载现有 React 卡片，再决定是否替换渲染层。

如果验证通过，可以让 Excalidraw 承担视口、图形交互和连线，让 Mindweave 继续维护节点内容、来源、增量更新和持久化。若需要修改上游内部交互才能实现日常阅读操作，则保留现有 HTML/SVG 画布，并优先考虑 `.excalidraw` 单向导出。当前证据不支持直接整体迁移。

## 二、可复用范围

Excalidraw 提供可嵌入的 React 组件，具备平移缩放、图形选择与拖动、箭头绑定、撤销重做、深色主题及 PNG/SVG/JSON 导出。npm 编辑器和 excalidraw.com 网站的功能范围不同；多人协作、网站自动保存和分享服务不能仅靠安装组件获得。[官方功能说明](https://github.com/excalidraw/excalidraw#features)、[协作 FAQ](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/faq)。

| 当前需求 | Excalidraw 提供的基础 | Mindweave 仍需承担的工作 |
| --- | --- | --- |
| 平移、缩放、拖动、选择 | 组件内置 | 接入现有视图保存和节点定位 |
| 节点连线 | 绑定箭头、线和文字标签 | 关系身份、去重、主干显示与选中后关联展示 |
| 标题与摘要 | 文字、带文字的容器 | 标题/摘要字段拆分、来源标记与编辑保护 |
| 展开详情、查看原文 | `renderEmbeddable` 可返回 JSX | 折叠、原文阅读、DOM 高度测量和交互适配 |
| 分支排列、展开避让 | 元素坐标和尺寸可由 API 更新 | 保留当前布局规则，区分保存锚点与临时展示位置 |
| 稳定引用 | 元素 ID、`customData`、链接回调 | `mindweave://` 解析、别名链和删除状态 |
| AI 再次整理 | `updateScene` 可更新场景 | 来源校验、重放去重、基础版本检查和人工层保护 |
| 撤销重做 | 编辑器内部历史 | 合并、删除等业务语义及刷新后的持久化历史 |
| 本地保存与冲突恢复 | `onChange` 提供场景变化 | 继续使用当前服务、版本校验和浏览器草稿 |

`customData` 是自定义元数据容器，可以保存 Mindweave 节点 ID，但不会自动实现上述业务规则。[Props 文档](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/)。

## 三、节点渲染的三种接入方式

### 3.1 原生图形与文字

将节点转换为矩形和绑定文字，将关系转换为绑定箭头，原文通过独立弹层查看。程序化生成已有官方辅助 API，适合结构化图导出和概览展示。[元素生成文档](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton)。

这条路径能充分复用编辑器，但需要调整当前产品交互。现有卡片含标题、摘要、长说明、来源摘录、完整消息、表单和菜单；原生文字元素不能直接承接这些 HTML 结构。独立弹层也会改变产品规则中“详情在节点内展开”的阅读方式。

手绘外观并非主要障碍：可以设置 `roughness: 0`、实色填充和普通字体，接近现有视觉方向。交互和数据适配的成本更高。

### 3.2 Embeddable 元素与自定义 React 卡片

官方 `renderEmbeddable(element, appState)` 允许替换 embeddable 元素默认的 iframe 渲染，返回 JSX。它可以作为复用现有卡片内容的入口。此能力仅针对 embeddable 元素，不是为任意图形注册新节点类型的通用接口。[Render Props 文档](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/render-props)。

已额外检查 npm 0.18.1 发布包：类型声明包含该接口；生产代码在元素容器中调用自定义渲染器。检查也发现，容器内部的 `pointerEvents` 取决于 embeddable 是否处于激活状态。普通选择和内部内容交互存在状态切换。[对应版本的 App 实现](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/components/App.tsx)。

需要实际验证的部分：

- 展开按钮、文本选择、双击编辑和滚动原文，能否保持当前操作方式。
- 拖动卡片与操作卡片内部按钮，能否可靠区分。
- 卡片展开后，DOM 测量高度如何更新元素高度、连线与避让位置。
- 内部输入框、中文输入法、快捷键和画布快捷键是否冲突。
- 自定义卡片如何导出为图像。内置导出使用元素绘制逻辑，不能据此推定会自动截取 React DOM；需要独立的图形投影或其他导出实现。[对应版本的导出绘制实现](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/renderer/renderElement.ts)。

当前 `NodeCard` 把内容、绝对定位、拖动、焦点和测量集中在同一组件中。复用时应先拆出内容部分，由 Excalidraw 控制外部几何与画布交互。可行性判断为：存在公开入口，交互适配成本待验证。

### 3.3 在画布上方叠加现有 HTML 节点

也可使用独立 DOM 层，根据 Excalidraw 视口同步节点位置。这能保留现有卡片的阅读方式，但需要自行处理命中、拖动、框选、焦点、层级和导出；保留的自研工作较多。对当前项目，建议仅在 embeddable 路径受限且已有明确复用收益时再考虑。

## 四、数据与操作的接入边界

当前核心类型位于 [types.ts](../src/core/types.ts)，人工操作与撤销在 [model.ts](../src/core/model.ts)，来源和增量保护在 [update.ts](../src/integration/update.ts)。这些能力应继续作为业务数据的权威入口。

建议的数据流如下：

1. `CanvasDocument` 经 `materialize` 生成有效节点与关系。
2. 适配器将有效图投影为 Excalidraw 元素，保留稳定的元素映射。
3. 编辑器操作经差异识别，转换为 Mindweave 的移动、编辑、连接、删除等命令。
4. 命令执行并通过现有规则保存后，再更新场景。

场景保存不能替代 `generated/user/view/history` 分层。Excalidraw 元素上的 `isDeleted` 也不能替代当前按来源抑制旧内容的删除记录。上游的场景格式可以作为视图或交换格式使用。

适配器至少需要处理以下边界：

| 边界 | 处理原则 |
| --- | --- |
| 稳定身份 | `customData` 保存业务 ID 与元素角色；一个节点可能对应多个图形元素 |
| 元素生成 | `convertToExcalidrawElements` 默认重新生成 ID；需要显式保留 ID，并测试重复投影 |
| 复制粘贴 | 克隆元素可能复制业务元数据；应定义为新笔记或禁止该操作，避免两个元素冒用同一节点身份 |
| 场景回调 | `onChange` 同时包含视图变化和程序化投影结果；不能把每次回调都认作用户内容编辑 |
| 拖动与展开避让 | 拖动结束才保存人工位置；展开导致的临时位移不写回锚点，不记入业务撤销 |
| 生成更新 | 合并现有场景的变化，保留人工位置、当前视口和编辑状态，避免整体重建 |
| 节点删除与合并 | 继续执行业务命令，保留来源删除记录与旧引用别名 |

元素生成 API 的 ID 默认行为见[官方说明](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton)。

撤销需要单独设计。`updateScene` 的 `captureUpdate` 可以控制程序化更新是否进入编辑器历史；AI 更新和临时布局可考虑 `CaptureUpdateAction.NEVER`。该选项并不能自动统一 Excalidraw 的图形历史与当前持久化的业务历史。需明确唯一的撤销入口，并验证“用户改标题 → AI 补充内容 → 撤销”仍只恢复用户字段。[API 与历史控制](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)。

## 五、版本、分发与维护成本

截至调研时，npm `latest` 为 **0.18.1**，React 和 React DOM 的 peer 范围包含 `^19.0.0`，覆盖本项目声明的 19.3.0。这说明声明版本兼容；Vite 构建和运行行为尚未验证。上游 `master` 的版本字段与 npm latest 不完全一致，后续实验应锁定发布版本。[npm 元数据](https://registry.npmjs.org/@excalidraw%2fexcalidraw/latest)、[0.18.1 发布记录](https://github.com/excalidraw/excalidraw/releases/tag/v0.18.1)。

读取发布包得到：tarball 为 31,234,066 字节，解包大小为 46,802,783 字节。它包含发布资源，不能当作浏览器首屏下载量；实际产物、压缩传输和字体占用需要构建测量。对自包含 skill 的分发方式，额外资源大小是需要纳入决策的成本。

字体默认从 CDN 下载。维持当前离线、本地使用方式时，需要随产物提供所用字体，并配置 `EXCALIDRAW_ASSET_PATH`，同时检查中文文本与图像导出的字体表现。[安装与字体自托管文档](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation)。

核心仓库使用 MIT 许可证，分发时需保留版权与许可声明；随包资源也应保留其相应声明。[上游许可证](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)。

建议使用公开 React 组件和 API。直接抽取内部拖拽、命中、连线或历史实现，需要承担其内部状态依赖和升级维护；目前没有证据表明这比接入组件更省工作。fork 整个应用同样会扩大维护范围。

## 六、建议的最小验证

先做独立实验入口，使用现有样例数据，保持当前业务数据和默认页面。实验只回答三个决定性问题：

1. **阅读交互**：用 embeddable 渲染卡片，在窄视口下完成展开、原文滚动、中文编辑、复制引用、拖动和缩放；确认公开 API 足以支持操作。
2. **数据一致性**：打通移动、字段编辑和删除回写，随后执行增量整理、合并引用与撤销；刷新后检查人工内容、位置和历史。
3. **分发与导出**：测量构建体积和首次加载，验证离线字体，以及 React 卡片的 PNG/SVG 导出策略。

可增加 100/500 节点的合成数据观察交互表现；这是待执行的验证计划，不是已测得的容量结论。

若以上验证通过，逐步接入渲染适配器，并复用现有集成回归测试。若基础阅读需要依赖上游私有实现或大面积覆盖内部 CSS，则终止替换实验。

另一个独立可交付方向是 `.excalidraw` 单向导出：将当前可见节点转换为原生图形和文字，保留来源引用，让用户在 Excalidraw 中继续排版。其初始成本预计低于完整替换，但外部编辑不自动回写 Mindweave，完整画布 JSON 仍用于业务数据备份。
