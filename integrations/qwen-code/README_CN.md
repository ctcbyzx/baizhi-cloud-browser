# Qwen Code 百智云浏览器扩展

[English](./README.md)

通过官方 MCP，在 Qwen Code 中检查百智云浏览器（Baizhi Cloud Browser / CapyBrowser）凭据、查询价格并管理浏览器运行。网页导航、读取和点击需要兼容的 CDP 客户端，例如 Playwright；本扩展提供管理配置和使用 Skill。

## 安装与配置

以下流程适用于 macOS / Bash，验证宿主为 Qwen Code **0.26.2**、Node.js 24。其他系统和宿主版本尚未验证。先安装 Qwen Code，并配置你自己的模型服务。此原生扩展不需要 npm 依赖或编译。

在同一目录取得扩展归档 `baizhi-cloud-browser-qwen-code-0.1.0.tar.gz` 和配套 `SHA256SUMS`，核对后解压安装：

```bash
shasum -a 256 -c SHA256SUMS
mkdir -p baizhi-cloud-browser-qwen-code-0.1.0
tar -xzf baizhi-cloud-browser-qwen-code-0.1.0.tar.gz -C baizhi-cloud-browser-qwen-code-0.1.0
qwen extensions install ./baizhi-cloud-browser-qwen-code-0.1.0
qwen extensions list
```

安装时审阅宿主显示的 MCP 和 Skill 权限。需要本服务自己的 API Key；百智 Agent Toolkit 是另一项服务。

下面在临时 Bash 中隐藏输入 Key，输入的内容不会成为命令历史或命令参数。不要开启命令追踪，也不要把真实 Key 填进命令、扩展文件或聊天。

```bash
bash
set +x
IFS= read -r -s -p 'Capy API Key: ' CAPYBROWSER_API_KEY
printf '\n'
export CAPYBROWSER_API_KEY
qwen mcp list
qwen
```

Key 输入原文，不加 `Bearer`；扩展会构造 `Authorization: Bearer <Key>`。Qwen 必须从这个 Bash 启动，才能继承变量。环境变量也可能被子进程继承，应只在可信环境中提供。

在 Qwen 聊天中输入 `/baizhi-cloud-browser:capy-browser` 显式加载 Skill，再提出下面的只读请求：

> 请加载百智云浏览器使用 Skill，只调用 browser_auth_check 和 browser_pricing，告诉我鉴权是否成功和当前价格，不创建运行，不输出账户详情。

按宿主实际提示批准所需工具。连接成功并不代表鉴权工具或网页任务成功；缺少 Key 或请求被拒绝时，先修正配置再重启 Qwen。自动化无交互运行应按宿主文档只授权需要的具体工具，不需要全局放开权限。

## 完成网页任务

给出网址和目标，例如“读取 example.com 的标题和正文”。加载 Skill 后，按其中流程先确认 CDP 客户端、价格及你的运行授权，再按需创建有时限的浏览器运行，并通过兼容客户端操作页面。MCP 本身不提供导航或点击工具，也不会替换 Qwen 的其他浏览器。

浏览器启动和运行可能收费，等待和人工处理期间也计费。任务完成、失败或取消后，应结束本任务创建的运行，核对 `released`，再单独核对结算金额。断开 CDP 不代表运行已结束。需要人工处理、重连或结果未知时，沿用原运行，按[正式使用指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)恢复。

## 禁用、重新启用与移除

退出正在运行的 Qwen 后，在使用扩展的工作目录选择下面的操作，并重启 Qwen 使变更生效。禁用和启用明确限于当前工作区：

```bash
qwen extensions disable --scope workspace baizhi-cloud-browser
qwen extensions enable --scope workspace baizhi-cloud-browser
qwen extensions uninstall baizhi-cloud-browser
qwen mcp list
unset CAPYBROWSER_API_KEY
exit
```

按需要选择禁用、启用或卸载；上面不是要求依次执行的任务。禁用和卸载不结束已创建的云浏览器，也不撤销服务端 Key。先确认本任务运行已释放；退出临时 Bash 会结束该环境变量的作用范围。无需编辑其他 MCP 配置。

## 支持范围

扩展连接 `https://capybrowser.app.baizhi.cloud/mcp`，将 Key 发给该官方服务；管理工具可以创建、修改和删除资源。它采用 Qwen 原生 `qwen-extension.json`，不表示官方市场收录。验证版本的 Agent Plugins v1 加载器会移除授权头，因此不提供该格式。本扩展以进程环境变量为凭据来源；没有承诺宿主敏感设置在所有入口中都可注入 HTTP 请求头。

扩展文件采用 [Apache-2.0](./LICENSE)，托管服务适用服务自身条款。服务能力与限制见[接入说明](https://capybrowser.app.baizhi.cloud/docs/installation.md)和[Agent 指南](https://capybrowser.app.baizhi.cloud/docs/skills.md)。

## 产品、源码与支持

[产品介绍](https://baizhibrowser.cloud/zh/)说明百智云浏览器的用途；[服务控制台](https://capybrowser.app.baizhi.cloud/)管理账号和运行，当前接口与使用合同以[正式指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)为准。各客户端扩展支持的范围以其自身说明为准。

本独立扩展由 [ctcbyzx](https://github.com/ctcbyzx) 维护，其[个人接入与插件仓库](https://github.com/ctcbyzx/baizhi-cloud-browser)是约定的源码与分发仓库，扩展目录为 `integrations/qwen-code/`。版本化归档和校验文件以该仓库发布页实际列出的 Qwen Code 版本为准；尚无对应版本时，维护者提供的归档同样适用上面的安装步骤。

[Chaitin 公共接入仓库](https://github.com/chaitin/baizhi-cloud-browser)维护公开接入材料；ctcbyzx 是接入材料维护者及该仓库的贡献者。该关联不表示此独立扩展已获 Chaitin 仓库收录或 Qwen 官方市场认可，两个仓库均不提供托管服务的后端源码。

扩展的安装、配置或 Skill 问题请到[维护仓库 Issues](https://github.com/ctcbyzx/baizhi-cloud-browser/issues)反馈，附 Qwen 版本、操作系统和脱敏复现步骤；账号、费用和私密问题通过服务控制台的支持入口反馈。不要在公开 Issue 中提交 Key、Cookie、CDP 地址或私密页面内容。
