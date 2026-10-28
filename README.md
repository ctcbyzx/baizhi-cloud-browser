<h1 align="center">百智云浏览器</h1>

<p align="center">Baizhi Cloud Browser（CapyBrowser）· 为 Agent 提供可复用的云端浏览器，支持网页操作、登录状态保存与人工介入。</p>

<p align="center">
  <a href="https://baizhibrowser.cloud/zh/">产品介绍</a> ·
  <a href="https://capybrowser.app.baizhi.cloud/">服务控制台</a> ·
  <a href="https://capybrowser.app.baizhi.cloud/docs/installation.md">接入指南</a> ·
  <a href="#客户端接入">客户端集成</a> ·
  <a href="https://github.com/ctcbyzx/baizhi-cloud-browser/issues">问题反馈</a>
</p>

## 项目介绍

百智云浏览器让 Agent 按需启动独立的云端浏览器，继续使用 Playwright、Puppeteer 等熟悉的工具访问和操作网页，无需在本机启动对应的 Chromium。

想了解 Agent 正在做什么，可以让它提供当前浏览器的观看链接；需要本人登录或确认时，再按授权进入同一浏览器处理，完成后交还 Agent。按接入指南成功保存登录后的浏览器状态，下次使用同一份状态启动时可继续复用；网站是否继续认可登录状态，取决于其自身规则。网页中下载或导出的文件，也可以通过接口取回。

需要不同网络来源时，可让 Agent 查询当前可用线路，并在创建运行时选择。线路是否可用及其价格以当前账号的目录为准，不保证固定 IP 或特定网站一定可访问。操作方式见[完整接入参考](https://capybrowser.app.baizhi.cloud/docs/browser-reference.md)。

本仓库由 **`ctcbyzx` 维护**，整理客户端插件、示例与 MCP 接入说明，**不包含托管服务的后端源码**。[Chaitin 组织仓库](https://github.com/chaitin/baizhi-cloud-browser)也已收录公开接入材料；agent-browser `v0.1.3` 与 DSH `v0.1.0` 的安装包从本仓库的 GitHub Release 分发；其他客户端以表中状态为准。在线服务的账号权限、使用规则和计费以[控制台](https://capybrowser.app.baizhi.cloud/)及[服务文档](https://capybrowser.app.baizhi.cloud/docs/installation.md)为准。

## 快速开始

把下面的提示词交给你正在使用的 AI 编程助手或 Agent，并补充要访问的网址和任务：

```text
请阅读百智云浏览器接入指南：
https://capybrowser.app.baizhi.cloud/docs/installation.md

使用云浏览器完成我指定的网页任务，并返回实际读取或操作的结果。
先核对服务地址和凭据用途，符合时沿用已有 MCP 与安全配置，只补缺少的接入能力。
如果我还没有给出网址和任务，请先询问。创建收费运行前，先确认页面客户端可用并查询价格。
需要我登录或确认时，保留同一次运行，暂停页面操作，待我交还后再继续；
不要把人工接管造成的断连当成任务异常而自动结束运行。
任务正常结束或发生其他异常时，都要有界结束本次创建的运行，分别核对资源释放与费用状态。
```

在 Agent 的安全配置中提供自己的 API Key；平台个人中心 Key 和云浏览器应用内 Key 均以 Bearer 方式调用。已有可用配置时直接复用，不要把真实 Key 粘贴进上述提示词、代码或公开反馈。

**MCP／HTTP API 管理浏览器运行；网页导航、点击和读取由 CDP 客户端执行。** 只接通 MCP 尚不代表 Agent 已具备页面操作能力，接入指南会引导它检查现有环境。HTTP 新 Agent 可使用指南中的官方首跑脚本完成一个小任务；已有匹配 MCP 配置的 Agent 沿用原入口，不重复创建运行。

## 客户端接入

| 入口 | 本仓库提供的能力 | 状态与限制 |
| --- | --- | --- |
| [Playwright／Puppeteer 等 CDP 客户端](https://capybrowser.app.baizhi.cloud/docs/installation.md) | 服务接入指南；沿用已有网页操作代码连接云端浏览器 | HTTP／MCP 管理运行，CDP 客户端操作页面 |
| [agent-browser](integrations/agent-browser/README.md) | 可安装的独立插件；管理云端运行，沿用 agent-browser 网页命令 | [v0.1.3 已发布](https://github.com/ctcbyzx/baizhi-cloud-browser/releases/tag/v0.1.3)；对应 Node.js 24+、agent-browser 0.38.2 |
| [DSH](integrations/dsh/README.md) | 百智云浏览器独立插件，按需启动云浏览器并接入网页工具 | [v0.1.0 安装包](https://github.com/ctcbyzx/baizhi-cloud-browser/releases/tag/dsh-v0.1.0)；适用 DSH Web 0.2.1-rc.3，安装和配置见插件说明 |
| [Qwen Code](integrations/qwen-code/README_CN.md) | 原生 MCP 配置和使用 Skill；页面操作需兼容 CDP 客户端 | 0.1.0 本地候选已完成验证，尚未发布；计划从本仓库分发，未获官方市场收录 |
| [ZCode](https://github.com/zai-org/zcode-plugins/pull/136) | 社区 MCP 插件，检查凭据并管理浏览器资源 | PR #136 待审，尚未收录；网页操作需单独 CDP 客户端 |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio-website/pull/75) | 中英文自定义 MCP 配置教程 | 中英文配置教程已合并，可按教程手动配置 MCP |
| [browser-use](docs/browser-use.md) | 网页读取示例、环境准备与异常恢复指南 | [PR #6100](https://github.com/browser-use/browser-use/pull/6100) 待审核；示例可从维护者分支获取 |
| [DeerFlow](docs/deerflow.md) | HTTP MCP 配置指南与插件目录入口说明 | [PR #6976](https://github.com/bytedance/deer-flow/pull/6976) 待审核；可先手动配置 HTTP MCP |
| [Cline／Kilo](docs/integrations.md#cline-与-kilo) | 远程 MCP 配置与市场条目 | [Cline #308](https://github.com/cline/marketplace/pull/308)、[Kilo #454](https://github.com/Kilo-Org/kilo-marketplace/pull/454) 正式待审、尚未收录；可按各客户端说明手动配置 |

接入状态核对于 2026-10-28，公开发布、文档合并与待审 PR 分别标注。各集成仅提供表中说明的能力。agent-browser 插件可独立安装，其[上游文档 PR #2132](https://github.com/vercel-labs/agent-browser/pull/2132)待审，不影响独立插件使用。[Awesome China MCP #9](https://github.com/zackchewa/awesome-china-mcp/pull/9)是目录投稿，仍待审核。其他待审内容在各自上游分支维护，最新状态以发布页或 PR 为准。更多说明见[生态集成说明](docs/integrations.md)。

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

agent-browser 插件采用其目录中的 [MIT License](integrations/agent-browser/LICENSE)，Qwen Code 扩展采用其目录中的 [Apache-2.0](integrations/qwen-code/LICENSE)。在线服务的使用权限与计费规则独立于插件许可证。
