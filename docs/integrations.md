# 生态集成说明

本页说明本仓库插件与相关上游接入内容的关系，便于选择安装入口。状态核对日期：2026-10-25；后续状态以对应发布页或 PR 为准。

## agent-browser

本仓库维护独立的 `browser.provider` 插件，源码和使用说明位于 [`integrations/agent-browser`](../integrations/agent-browser/README.md)。它管理百智云云浏览器运行与 CDP 连接，网页导航、快照、点击和输入仍由 agent-browser 执行。

- 分发：[`v0.1.3` GitHub Release](https://github.com/ctcbyzx/baizhi-cloud-browser/releases/tag/v0.1.3)，不通过 npm registry 分发。
- 当前说明对应 Node.js 24 或更新版本、agent-browser `0.38.2`。
- 包名为 `agent-browser-plugin-capybrowser`，provider 名称为 `capy`；这些技术名称与面向用户的产品名“百智云云浏览器”并用。
- 上游文档入口：[agent-browser PR #2132](https://github.com/vercel-labs/agent-browser/pull/2132)，已提交、尚未合并。插件安装不依赖此 PR 合并。

## browser-use

面向使用者的步骤见 [browser-use 接入指南](browser-use.md)。

接入示例位于 [browser-use PR #6100](https://github.com/browser-use/browser-use/pull/6100)，已转为正式待审、尚未合并。示例将百智云云浏览器的一次运行接入 browser-use Agent，并处理一次性 CDP 控制地址和运行结束。

示例在 browser-use 上游分支维护，本仓库仅提供入口，不另存一份待审源码。阅读时以 PR 中的依赖和运行说明为准；尚不能将其表述为 browser-use 已内置的服务提供方。

## DeerFlow

面向使用者的步骤见 [DeerFlow 接入指南](deerflow.md)。

[DeerFlow PR #6976](https://github.com/bytedance/deer-flow/pull/6976) 提供云浏览器的插件目录入口，已转为正式待审、尚未合并。它用于发现和配置服务，不在本仓库提供 DeerFlow 运行时代码。

## Cline 与 Kilo

已有支持远程 MCP 的 Cline 或 Kilo 客户端时，可按各自客户端说明配置 Streamable HTTP 服务 `https://capybrowser.app.baizhi.cloud/mcp`，在私有配置中设置 `Authorization: Bearer <自己的 API Key>`。保留其他 MCP 配置，不默认开启自动批准。

- [Cline 市场 PR #308](https://github.com/cline/marketplace/pull/308)：提供远程 MCP 条目，正式待审、尚未收录。
- [Kilo 市场 PR #454](https://github.com/Kilo-Org/kilo-marketplace/pull/454)：提供远程 MCP 定义，正式待审、尚未收录。

连接后先验证身份、查询价格；创建运行前确认 Agent 有兼容 CDP 的页面操作能力。市场条目用于发现和配置服务，不会为客户端自动安装页面操作工具，也不代表两者已内置云浏览器。配置形状以所用客户端版本的说明为准。

## 直接接入

已有 Playwright、Puppeteer 或其他兼容 CDP 客户端时，可直接按[在线接入指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)使用 HTTP API／MCP 管理运行，再连接云端浏览器，无需安装本仓库的 agent-browser 插件。

产品用途与场景见[中文站](https://baizhibrowser.cloud/zh/)或 [English site](https://baizhibrowser.cloud/)。当前观看、人工介入和线路选择等服务用法以[在线接入指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)为准；插件及示例的命令范围仍以各自说明为准。

提交上游 PR、发布独立插件与被上游正式收录是不同状态。这里的链接不代表第三方项目对服务的认证或背书。
