# 百智云浏览器 DSH 插件

用百智云浏览器（Baizhi Cloud Browser，也称 CapyBrowser）为 DSH 的网页任务按需创建远程浏览器。浏览器就绪后按[实时价格](https://capybrowser.app.baizhi.cloud/docs/installation.md)计费；等待和断线期间也计费。结束运行与费用结算是两个不同状态。

本候选包名为 `dsh-baizhi-cloud-browser`，版本 `0.1.0`，尚未发布。当前仅验证 DSH Web `0.2.1-rc.3`（宿主 `22ddee3`）和 Node.js 24.22.1；其他 DSH 版本、Desktop、真实模型体验及平台 Key 全链尚未验证。

## 安装与使用

取得本地候选包后执行：

```sh
dsh plugin --profile web add /绝对路径/dsh-baizhi-cloud-browser-0.1.0.tgz
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

在启动 DSH 的环境中设置 `CAPYBROWSER_API_KEY`，然后启动 `dsh --profile web`。例如让 Agent 打开 `https://example.com` 并读取标题和页面说明。Agent 按需调用 `capy_start`，随后使用网页工具；插件在回合结束、取消或退出时尝试结束自己创建的运行。

## 清理失败与恢复

出现横幅时，打开其中的百智云浏览器控制台，按显示的原运行编号检查并停止；再重新启用插件核对。控制台显示的释放状态和账单结算分别确认。

如果横幅说运行编号未知，先按显示的记录时间到控制台核对，停止可能相关的原运行；**只有确认已核对并处理，或确认没有运行时**，才点击该记录的“已在控制台核对，处理此记录”，阅读提示并再次确认。此操作只解除这一条本地阻断，保留处理记录，**不证明云运行已释放或账单已结算**。然后重新启用插件，才能开始下一任务。旧记录没有时间时按任务时间排查；如果仍无法确认，取消操作并联系支持，保留状态目录，不要重复启动浏览器。

停用：把 profile 中 `baizhi-cloud-browser` 的 `disabled` 改为 `true`。卸载：`dsh plugin --profile web remove dsh-baizhi-cloud-browser`。停用或卸载不会代替结束云运行，处理完未确认的运行前请保留状态目录。
