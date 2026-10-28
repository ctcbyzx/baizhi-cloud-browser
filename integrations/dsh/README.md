# 百智云浏览器 DSH 插件

用百智云浏览器（Baizhi Cloud Browser，也称 CapyBrowser）为 DSH 的网页任务按需创建远程浏览器。浏览器就绪后按[实时价格](https://capybrowser.app.baizhi.cloud/docs/installation.md)计费；等待和断线期间也计费。结束运行与费用结算是两个不同状态。

独立插件 `dsh-baizhi-cloud-browser` **0.1.0 已发布**，从 [dsh-v0.1.0 发布页](https://github.com/ctcbyzx/baizhi-cloud-browser/releases/tag/dsh-v0.1.0)取得安装包。当前仅验证 DSH Web `0.2.1-rc.3`（宿主 `22ddee3`）和 Node.js 24.22.1；其他 DSH 版本、Desktop、真实模型体验及平台 Key 全链尚未验证。

## 安装与使用

从上述发布页下载 `dsh-baizhi-cloud-browser-0.1.0.tgz`，核对 SHA-256 后执行：

```sh
# 安装包 SHA-256：f365fc00bb480ff4ae9f966c2678411abe6c46f6194a0a9d76351d39602ed22a
shasum -a 256 /下载路径/dsh-baizhi-cloud-browser-0.1.0.tgz
dsh plugin --profile web add /下载路径/dsh-baizhi-cloud-browser-0.1.0.tgz
```

在对应 profile 的 `cordis.patch.yml` 中加入，目录请换成自己可写且持久的路径：

```yaml
- id: baizhi-cloud-browser
  disabled: false
  config:
    stateDir: /绝对路径/baizhi-dsh-state
    apiKeyEnv: CAPYBROWSER_API_KEY
    maxSeconds: 180
```

在启动 DSH 的环境中设置 `CAPYBROWSER_API_KEY`，值为本服务 Key 原文，不加 `Bearer`，然后启动 `dsh --profile web`。例如让 Agent 打开 `https://example.com` 并读取标题和页面说明。Agent 按需调用 `capy_start`，随后使用网页工具；插件在回合结束、取消或退出时尝试结束自己创建的运行。

## 清理失败与恢复

出现横幅时，打开其中的百智云浏览器控制台，按显示的原运行编号检查并停止；再重新启用插件核对。控制台显示的释放状态和账单结算分别确认。

如果横幅说运行编号未知，先按显示的记录时间到控制台核对，停止可能相关的原运行；**只有确认已核对并处理，或确认没有运行时**，才点击该记录的“已在控制台核对，处理此记录”，阅读提示并再次确认。此操作只解除这一条本地阻断，保留处理记录，**不证明云运行已释放或账单已结算**。然后重新启用插件，才能开始下一任务。旧记录没有时间时按任务时间排查；如果仍无法确认，取消操作并联系支持，保留状态目录，不要重复启动浏览器。

停用：把 profile 中 `baizhi-cloud-browser` 的 `disabled` 改为 `true`。卸载：`dsh plugin --profile web remove dsh-baizhi-cloud-browser`。停用或卸载不会代替结束云运行，处理完未确认的运行前请保留状态目录。

## 产品、维护与反馈

[产品介绍](https://baizhibrowser.cloud/zh/)说明百智云浏览器的用途；账号和运行在[服务控制台](https://capybrowser.app.baizhi.cloud/)管理，当前用法和费用合同以[正式接入指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)为准。本插件支持的 DSH 版本与能力以上述说明为准。

[ctcbyzx](https://github.com/ctcbyzx)维护本独立插件，[个人仓库的 DSH 目录](https://github.com/ctcbyzx/baizhi-cloud-browser/tree/main/integrations/dsh)提供公开插件文件与说明，版本包从本仓库 Release 分发。ctcbyzx 同时维护公开接入材料并向 [Chaitin 公共接入仓库](https://github.com/chaitin/baizhi-cloud-browser)作出贡献；这不表示本插件已获 DSH 官方收录。两个接入仓均不包含托管服务后端源码。

安装与插件问题请到[个人维护仓 Issues](https://github.com/ctcbyzx/baizhi-cloud-browser/issues)反馈，提供宿主版本和脱敏复现步骤；账号、账务及私密问题通过服务控制台的支持入口反馈。不要公开 Key、Cookie、CDP 地址、人工控制链接或私密页面内容。

安装包内的说明保留发布时版本，最新安装步骤与支持入口以本页为准。
