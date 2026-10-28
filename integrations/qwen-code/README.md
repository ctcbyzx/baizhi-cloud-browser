# Baizhi Cloud Browser for Qwen Code

[中文](./README_CN.md)

Use the official Baizhi Cloud Browser (CapyBrowser) MCP service to check credentials, read prices and manage browser sessions from Qwen Code. Page navigation, reading and clicking require a compatible CDP client, such as Playwright. This extension supplies management configuration and a usage Skill.

## Install and configure

The following steps target macOS / Bash, tested with Qwen Code **0.26.2** and Node.js 24. Other platforms and host versions have not been verified. Install Qwen Code and configure your own model provider first. This native extension needs no npm dependencies or build.

Place `baizhi-cloud-browser-qwen-code-0.1.0.tar.gz` and its `SHA256SUMS` in the same directory. Verify, extract and install:

```bash
shasum -a 256 -c SHA256SUMS
mkdir -p baizhi-cloud-browser-qwen-code-0.1.0
tar -xzf baizhi-cloud-browser-qwen-code-0.1.0.tar.gz -C baizhi-cloud-browser-qwen-code-0.1.0
qwen extensions install ./baizhi-cloud-browser-qwen-code-0.1.0
qwen extensions list
```

Review the MCP and Skill permissions shown by the host. Use an API Key for this service; Baizhi Agent Toolkit is a separate service.

Open a temporary Bash and enter the Key through a hidden prompt. The value is not a shell command or a process argument. Keep tracing off and never insert the real Key into commands, extension files or chat.

```bash
bash
set +x
IFS= read -r -s -p 'Capy API Key: ' CAPYBROWSER_API_KEY
printf '\n'
export CAPYBROWSER_API_KEY
qwen mcp list
qwen
```

Enter the raw Key without `Bearer`; the extension builds `Authorization: Bearer <Key>`. Launch Qwen from this Bash so it inherits the variable. Child processes may also inherit it; use a trusted environment.

In Qwen chat, enter `/baizhi-cloud-browser:capy-browser` to load the Skill explicitly, then make the following read-only request:

> Load the Baizhi Cloud Browser Skill. Call only browser_auth_check and browser_pricing. Report authentication success and current prices, without creating a session or exposing account details.

Approve the tools when the host asks. A connected server does not prove a successful authentication call or page task. Correct missing or rejected credentials and restart Qwen. For unattended use, authorize only the specific tools needed according to the host documentation; global permission bypass is unnecessary.

## Complete a page task

Provide a URL and goal, such as reading the title and text of example.com. Once the Skill is loaded, follow its checks for the CDP client, pricing and your runtime authorization before creating a bounded session and operating it through the compatible client. MCP management does not supply navigation/click tools or replace Qwen's other browser integrations.

Browser startup and runtime may be billed, including waiting and human intervention. On completion, failure or cancellation, stop the session created for this task, verify `released`, then separately check the settled charge. Disconnecting CDP does not stop the session. Recover human handoffs, disconnections and uncertain outcomes on the original session according to the [official guide](https://capybrowser.app.baizhi.cloud/docs/installation.md).

## Disable, re-enable and remove

Exit running Qwen processes, choose the relevant command in your working directory, then restart Qwen. Disable and enable below explicitly target the current workspace:

```bash
qwen extensions disable --scope workspace baizhi-cloud-browser
qwen extensions enable --scope workspace baizhi-cloud-browser
qwen extensions uninstall baizhi-cloud-browser
qwen mcp list
unset CAPYBROWSER_API_KEY
exit
```

Choose the disable, enable or uninstall operation you need; these are alternatives, not a required sequence. Neither disabling nor uninstalling stops cloud sessions or revokes the service Key. Verify task cleanup first. Exiting the temporary Bash ends this variable's scope. No other MCP configuration needs editing.

## Scope

The extension sends the Key to the official endpoint `https://capybrowser.app.baizhi.cloud/mcp`. Management tools can create, change and delete resources. It uses native `qwen-extension.json`; this does not imply official marketplace listing. The tested Agent Plugins v1 loader removes authorization headers, so that format is not provided. This extension uses process environment credentials and does not promise that host sensitive settings inject HTTP headers in every entry point.

Extension files use [Apache-2.0](./LICENSE); the hosted service has its own terms. See the [installation guide](https://capybrowser.app.baizhi.cloud/docs/installation.md) and [Agent guide](https://capybrowser.app.baizhi.cloud/docs/skills.md) for current service capabilities and limits.

## Product, source and support

The [product website](https://baizhibrowser.cloud/) introduces Baizhi Cloud Browser. The [service console](https://capybrowser.app.baizhi.cloud/) manages accounts and sessions; the [official guide](https://capybrowser.app.baizhi.cloud/docs/installation.md) defines current interfaces and usage. Each client extension supports the scope stated in its own documentation.

[ctcbyzx](https://github.com/ctcbyzx) maintains this independent extension. The [personal integration and plugin repository](https://github.com/ctcbyzx/baizhi-cloud-browser) is its designated source and distribution repository, under `integrations/qwen-code/`. Use the Qwen Code archive and checksum actually listed in that repository's releases. If no corresponding release is listed, the installation steps above also apply to an archive supplied by the maintainer.

The [Chaitin public integration repository](https://github.com/chaitin/baizhi-cloud-browser) maintains public integration materials; ctcbyzx maintains integration materials and has contributed to that repository. This relationship does not imply that this extension has been imported there or endorsed by the Qwen marketplace. Neither repository supplies the hosted service's backend source.

Report extension installation, configuration or Skill issues through the [maintainer repository's Issues](https://github.com/ctcbyzx/baizhi-cloud-browser/issues), including Qwen version, operating system and sanitized reproduction steps. Use the console's support channel for account, billing or private matters. Do not post Keys, cookies, CDP addresses or private page content in public issues.
