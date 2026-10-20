# DeerFlow 接入

DeerFlow 可通过 HTTP MCP 连接百智云云浏览器，使用其身份验证、价格查询、浏览器运行、Profile、人工处理和下载管理工具。

**这条连接提供浏览器运行管理能力。** 页面导航、点击和输入仍需要 Agent 可调用的 CDP 客户端；添加 MCP 不会自动替换 DeerFlow 自带的浏览器后端。

## 配置连接

在支持个人 HTTP MCP 连接的 DeerFlow 中，使用以下信息添加服务：

| 配置项 | 填写内容 |
| --- | --- |
| 连接名称 | 例如 `baizhi-cloud-browser` |
| 类型 | HTTP（Streamable HTTP） |
| 服务地址 | `https://capybrowser.app.baizhi.cloud/mcp` |
| 请求头名称 | `Authorization` |
| 请求头值 | `Bearer <自己的 API Key>` |

API Key 放在 DeerFlow 的凭据配置中，不放进对话或版本控制。如果界面已经提供名为“授权请求头”的密码框，该框只填写 `Bearer <自己的 API Key>`；不要再加 `Authorization:` 前缀。

我们向 DeerFlow 提交了[目录卡片 PR #6976](https://github.com/bytedance/deer-flow/pull/6976)，尚未合并。在包含该变更的版本中，可通过“能力中心 → 插件”搜索“百智云云浏览器”，然后填写连接名称、服务地址和授权请求头。当前版本若没有这张卡片，使用其已有的 HTTP MCP 配置入口手动添加；具体菜单以所用 DeerFlow 版本的说明为准。

## 开始使用

1. 保存连接后，让 Agent 先调用 `browser_auth_check` 验证身份，再调用 `browser_pricing` 查询当前价格；这两步不启动浏览器。
2. 给 Agent 提供[云浏览器接入指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)和你的网页任务。创建运行前，先确认它拥有可连接 CDP 的页面操作能力。
3. 用 MCP 创建限时运行、等待就绪并申请控制地址，再由 CDP 客户端访问和操作网页。需要本人登录或确认时，按接入指南发起人工处理。
4. 任务完成或发生异常时，结束本次创建的运行，再分别核对资源释放和账单状态。断开 MCP 或 CDP 连接不会自动结束云端运行。

只安装目录条目或成功列出工具，不代表网页任务已经完成。已有其他 MCP 配置时，只添加本服务，保留原有连接和权限设置。

[返回仓库首页](../README.md) · [生态集成状态](integrations.md)
