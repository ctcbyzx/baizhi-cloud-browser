# 百智云云浏览器（Baizhi Cloud Browser）接入

本仓库由 `ctcbyzx` 维护，收录连接百智云云浏览器的独立客户端接入代码。在线服务、权限与计费以[服务文档](https://capybrowser.app.baizhi.cloud/docs/installation.md)和实际账户信息为准。本仓库不包含服务端源码。

## agent-browser 插件

[插件源码与完整使用说明](integrations/agent-browser-capy-provider/README.md)位于 `integrations/agent-browser-capy-provider/`，该子目录采用其 `LICENSE` 所列 MIT 许可。插件让 `agent-browser` 通过一次性 CDP 控制地址使用 Baizhi Cloud Browser Session；页面操作仍由 `agent-browser` 执行。运行时 provider 名称是 `capy`。

### 从 GitHub 发布附件安装

准备 Node.js 24 或更新版本。取得本仓库 `v0.1.3` 发布附件 `agent-browser-plugin-capybrowser-0.1.3.tgz`，在下载目录核对 SHA-256 后安装；这里的 tgz 是独立分发物，不要求插件发布到 npm registry。

```sh
shasum -a 256 agent-browser-plugin-capybrowser-0.1.3.tgz
# 预期：304fceacb74c3ffa4aed7f105ee8247563d7e5a5de5f4d44e3f013fe0c8388d1
npm install --global agent-browser@0.38.2
npm install --global ./agent-browser-plugin-capybrowser-0.1.3.tgz
```

在项目的 `agent-browser.json` 注册已安装的可执行文件：

```json
{
  "plugins": [
    {
      "name": "capy",
      "command": "capy-agent-browser-provider",
      "capabilities": ["browser.provider", "command.run"]
    }
  ]
}
```

在本机环境或安全凭据管理器配置 `CAPYBROWSER_BASE_URL` 与 `CAPYBROWSER_API_KEY`，不要将 Key 写入仓库或 `agent-browser.json`。使用方法、断线重连、显式结束 Session、下载制品取回和本地构建步骤见[插件说明](integrations/agent-browser-capy-provider/README.md)。目前使用上面的 tgz 安装流程。连接断开不代表云端 Session 已结束；结束后确认资源释放与结算状态。

[HTTP OpenAPI](https://capybrowser.app.baizhi.cloud/docs/browser-session-openapi.yaml)与[MCP 接入说明](https://capybrowser.app.baizhi.cloud/docs/installation.md)可直接使用在线服务，无需安装本插件。
