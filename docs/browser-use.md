# browser-use 接入

已有 browser-use Agent 时，可以将页面操作连接到百智云云浏览器（Baizhi Cloud Browser，也称 CapyBrowser），由云端提供浏览器运行，browser-use 负责读取与操作网页。

当前提供一个完整的公开网页读取示例：读取 W3C 示例页的标题与说明句，返回内容，并结束浏览器运行、查询资源释放和账单状态。示例位于 [browser-use PR #6100](https://github.com/browser-use/browser-use/pull/6100)，正式待审、尚未合并；可从维护者分支获取，不要求安装 agent-browser 插件。

## 准备环境

- Python 3.11 或更新版本、`uv`，以及 macOS／Linux；Windows 可使用 WSL。
- 示例对应 browser-use `0.13.13`，请使用下方分支及其依赖，不直接套用到其他版本。
- 百智云云浏览器 API Key。
- 模型凭据：默认使用 `BROWSER_USE_API_KEY`；其他兼容模型网关的配置方法见[示例说明](https://github.com/ctcbyzx/browser-use/blob/ec7b28ae229fbcd3899daddecb177455d9a5ab96/examples/integrations/capybrowser/README.md)。模型调用和浏览器运行分别计费。

将凭据放在安全环境或凭据管理器中；不要写进命令参数、代码或提示词。示例不自动读取 `.env` 文件。

## 运行示例

获取包含接入示例的维护者分支：

```sh
git clone --single-branch --branch codex/baizhi-cloud-browser-example https://github.com/ctcbyzx/browser-use.git
cd browser-use
uv sync --no-default-groups
```

先在安全环境中配置 `CAPYBROWSER_API_KEY` 和默认模型需要的 `BROWSER_USE_API_KEY`。在仓库之外建立私有运行记录目录，再执行示例：

```sh
mkdir -m 700 ../baizhi-browser-runs
uv run --no-sync examples/integrations/capybrowser/main.py run --state ../baizhi-browser-runs/example-001
```

`example-001` 必须是尚未存在的新目录。示例会保存原始创建记录，创建一个限时临时浏览器，运行网页读取任务，再尝试结束并输出结果。请保留该目录，直到资源释放和账单状态核清。

这个例子用于先跑通一次公开网页任务，不包含 Profile、人工登录或跨运行登录状态复用。扩展到自己的任务前，请阅读[示例使用说明](https://github.com/ctcbyzx/browser-use/blob/ec7b28ae229fbcd3899daddecb177455d9a5ab96/examples/integrations/capybrowser/README.md)中关于依赖、任务范围和连接生命周期的说明。

## 异常恢复与结束

示例会在正常完成和可处理的异常后尝试结束云端运行。意外断电、进程被强制终止或服务不可达时，使用同一份运行记录恢复检查：

```sh
uv run --no-sync examples/integrations/capybrowser/main.py recover --state ../baizhi-browser-runs/example-001
```

恢复使用原来的云浏览器凭据，不需要模型 Key，也不会重跑 Agent 网页任务。创建结果未知时，它沿用原幂等键和请求正文查明结果；不要删除记录或换目录重新创建。

运行输出会区分网页任务结果、停止请求、资源释放和结算。模型回答成功不等于清理完成；账单待确认也不能按零费用处理。完整字段和退出码见[示例说明](https://github.com/ctcbyzx/browser-use/blob/ec7b28ae229fbcd3899daddecb177455d9a5ab96/examples/integrations/capybrowser/README.md)。

[返回仓库首页](../README.md) · [生态集成状态](integrations.md)
