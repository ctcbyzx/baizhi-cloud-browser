<h1 align="center">百智云云浏览器</h1>

<p align="center">Baizhi Cloud Browser · 为 Agent 提供可复用的云端浏览器，支持网页操作、登录状态保存与人工介入。</p>

<p align="center">
  <a href="https://capybrowser.app.baizhi.cloud/">服务控制台</a> ·
  <a href="https://capybrowser.app.baizhi.cloud/docs/installation.md">接入指南</a> ·
  <a href="#客户端接入">客户端集成</a> ·
  <a href="https://github.com/ctcbyzx/baizhi-cloud-browser/issues">问题反馈</a>
</p>

## 项目介绍

百智云云浏览器让 Agent 按需启动独立的云端浏览器，继续使用 Playwright、Puppeteer 等熟悉的工具访问和操作网页，无需在本机启动对应的 Chromium。

需要本人登录或确认时，可以进入同一浏览器处理，再交还 Agent。按接入指南保存登录后的浏览器状态，下次运行可继续复用；网站是否继续认可登录状态，取决于其自身规则。网页中下载或导出的文件，也可以通过接口取回。

本仓库由 **`ctcbyzx` 维护**，整理 agent-browser 插件、browser-use 示例与 DeerFlow 配置说明，**不包含托管服务的后端源码**。在线服务的账号权限、使用规则和计费以[控制台](https://capybrowser.app.baizhi.cloud/)及[服务文档](https://capybrowser.app.baizhi.cloud/docs/installation.md)为准。

## 快速开始

把下面的提示词交给你正在使用的 AI 编程助手或 Agent，并补充要访问的网址和任务：

```text
请阅读百智云云浏览器接入指南：
https://capybrowser.app.baizhi.cloud/docs/installation.md

使用云浏览器完成我指定的网页任务，并返回实际读取或操作的结果。
沿用已有的 MCP 和安全配置的凭据，只补缺少的接入能力。
如果我还没有给出网址和任务，请先询问。任务正常结束或发生异常时，
都要结束本次创建的浏览器运行，核对资源释放与费用状态。
```

在 Agent 的安全配置中提供自己的 API Key；平台个人中心 Key 和云浏览器应用内 Key 均以 Bearer 方式调用。已有可用配置时直接复用，不要把真实 Key 粘贴进上述提示词、代码或公开反馈。

**MCP／HTTP API 管理浏览器运行；网页导航、点击和读取由 CDP 客户端执行。** 只接通 MCP 尚不代表 Agent 已具备页面操作能力，接入指南会引导它检查现有环境。

## 客户端接入

| 入口 | 本仓库提供的能力 | 状态与限制 |
| --- | --- | --- |
| [Playwright／Puppeteer 等 CDP 客户端](https://capybrowser.app.baizhi.cloud/docs/installation.md) | 服务接入指南；沿用已有网页操作代码连接云端浏览器 | HTTP／MCP 管理运行，CDP 客户端操作页面 |
| [agent-browser](integrations/agent-browser/README.md) | 可安装的独立插件；管理云端运行，沿用 agent-browser 网页命令 | [v0.1.3 已发布](https://github.com/ctcbyzx/baizhi-cloud-browser/releases/tag/v0.1.3)；对应 Node.js 24+、agent-browser 0.38.2 |
| [browser-use](docs/browser-use.md) | 网页读取示例、环境准备与异常恢复指南 | [草稿 PR #6100](https://github.com/browser-use/browser-use/pull/6100) 待审核；示例可从维护者分支获取 |
| [DeerFlow](docs/deerflow.md) | HTTP MCP 配置指南与插件目录入口说明 | [草稿 PR #6976](https://github.com/bytedance/deer-flow/pull/6976) 待审核；可先手动配置 HTTP MCP |

接入状态核对于 2026-10-20，最新状态以发布页或 PR 为准。agent-browser 插件通过 GitHub Release 安装包分发；browser-use 和 DeerFlow 的待审内容在各自上游仓库维护。更多说明见[生态集成说明](docs/integrations.md)。

## 连接信息

| 配置项 | 值 |
| --- | --- |
| 服务控制台 | `https://capybrowser.app.baizhi.cloud` |
| HTTP API 根路径 | `https://capybrowser.app.baizhi.cloud/openapi/v1` |
| MCP 地址 | `https://capybrowser.app.baizhi.cloud/mcp` |
| MCP 传输协议 | Streamable HTTP |
| 鉴权方式 | `Authorization: Bearer <API Key>` |
| 本仓库插件使用的环境变量 | `CAPYBROWSER_BASE_URL`、`CAPYBROWSER_API_KEY` |
| 页面操作连接 | 为已就绪的运行申请一次性 CDP 控制地址 |

完整参数与返回结构见 [HTTP OpenAPI](https://capybrowser.app.baizhi.cloud/docs/browser-session-openapi.yaml)，Agent 执行流程见 [Skill 文档](https://capybrowser.app.baizhi.cloud/docs/skills.md)。

## 运行与费用

创建浏览器运行前，请先在控制台或通过 [`GET /openapi/v1/pricing`](https://capybrowser.app.baizhi.cloud/openapi/v1/pricing) 查询当前价格；接口需要 API Key。查询版本、验证身份和查询价格本身不启动浏览器。

等待 Agent、人工处理和连接断开期间仍计入运行时长。任务结束后主动停止自己创建的运行；**断开 CDP 连接不代表云端运行已结束**。停止受理或到期后停止运行计费，资源释放与账单结算分别核对，实际费用以账单为准。

## 贡献与支持

欢迎完善客户端适配、接入示例和使用文档。贡献方式见[贡献指南](CONTRIBUTING.md)，插件开发与验证命令见[插件说明](integrations/agent-browser/README.md)。

- 接入或插件问题：提交 [Issue](https://github.com/ctcbyzx/baizhi-cloud-browser/issues)，附客户端版本、复现步骤与脱敏错误。
- 账号、计费和私密问题：通过服务控制台提供的支持渠道反馈。
- 安全问题与凭据泄漏：按[安全说明](SECURITY.md)处理，不在公开 Issue 中贴出敏感信息。

agent-browser 插件采用其目录中的 [MIT License](integrations/agent-browser/LICENSE)。在线服务的使用权限与计费规则独立于插件许可证。
