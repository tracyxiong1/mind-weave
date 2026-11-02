# Excalidraw 兼容预览入口

Excalidraw 已合并到正式画布。此目录只保留 5180 端口的兼容配置，使用仓库根目录的入口、API、字体和构建插件；不再维护独立原型或独立数据接口。

```bash
npm run dev:excalidraw
```

访问 [画布](http://localhost:5180/)。默认 `npm run dev` 仍使用 5173；两个入口支持相同的样例、真实会话加载、编辑、保存与引用回读。浏览器草稿按 origin 隔离，端口之间不自动复制。

同一个 origin 已有正式草稿时优先保留正式草稿；只有正式草稿缺失时，才读取 `excalidraw-experiment:` 前缀的旧验证页草稿及有效来源。保存写入原正式键，旧键保留。损坏数据不会被自动覆盖。

```bash
npm run test:excalidraw # 正式画布的引擎、阅读与旧草稿回归
npm run build:excalidraw # npm run build 的兼容别名，产物为根目录 dist/
```

正式实现位于 `src/canvas/`。功能对齐、安装验收与后续边界见 [迁移记录](../../docs/validation/excalidraw/README.md)。早期 embeddable 原型的截图和测量保留在 [历史记录](../../docs/validation/excalidraw/prototype.md)，其中性能数字不代表当前 HTML 阅读层。
