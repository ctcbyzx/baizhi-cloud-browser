---
name: capy-browser
description: Use Baizhi Cloud Browser to check credentials, manage bounded browser sessions and complete page tasks through a compatible CDP client.
---

# Baizhi Cloud Browser

Use the configured `baizhi-cloud-browser` MCP at `https://capybrowser.app.baizhi.cloud/mcp`. Reuse matching authorization already supplied by the user. Baizhi Agent Toolkit is a different service. Never send this service's Key to another origin or expose Keys, cookies or CDP/control URLs in chat, commands or logs.

Read the current [installation guide](https://capybrowser.app.baizhi.cloud/docs/installation.md) before the first page task. Use the [full Agent guide](https://capybrowser.app.baizhi.cloud/docs/skills.md) and [reference](https://capybrowser.app.baizhi.cloud/docs/browser-reference.md) only as needed for recovery, profiles and handoff. If guides cannot be read, explain the limitation and avoid guessing unknown contracts.

## Start without a paid session

1. Discover the configured tools. Call `browser_auth_check`, check `isError`, and parse JSON in text content. Report success without account details unless requested. Compare identity only in the same service/environment and namespace; missing attribution remains unknown.
2. Call `browser_pricing`. These calls do not create sessions. If credentials fail, fix the environment and restart Qwen; do not create a session to test a Key.
3. For a page task, confirm a compatible CDP client is available **before** creation. Use an existing client or prepare `playwright-core` without downloading local browsers. This extension supplies management tools, not navigation/click tools. If no page client can run, explain that blocker before spending.
4. Explain runtime charges when first relevant. Honor the user's existing authorization and budget; request instruction only when the requested creation is not already authorized. Start only when there is a concrete page task.

## Create once and operate

- Choose a bounded `max_seconds` for the task and one unique stable `idempotency_key` for its logical creation. Keep private recovery information containing that key, arguments and original session ID; no API Key or CDP URL in the record. Use one management entry point to create exactly once. An uncertain response is recovered with the same key and arguments; never replace the key to bypass uncertainty.
- Poll `browser_get_session` on the original session within a deadline until `ready`. Stop page work on failure, release or expiry. Do not create a replacement session just because startup is slow.
- Call `browser_control` once when ready. Pass its short-lived one-use CDP address to the compatible client in process memory, not shell arguments or chat. Reuse the existing browser context and page. Verify the actual target content rather than accepting a challenge/login page as success.
- Do not request control again during a healthy connection. After an unexpected disconnect, query the original session and human-action status first. When permitted by the reference, obtain fresh control and find the original page. Never replay a page write whose result is unknown, and never create another session to reconnect.
- If human intervention is needed, use the published handoff contract and provide only the returned human-action link for the task. Pause automation during human control. Resume only after confirming handback/status on the same session, then observe the page before acting. Do not interpret a CDP disconnect alone as handback or completion.

## Finish and recover

End only resources created for this task or explicitly assigned to you for cleanup. Disconnect the page client in bounded `finally` cleanup; even if it fails, attempt `browser_stop_session` on the original session. Poll within a deadline for `released`. A stop acknowledgement, CDP disconnect or local timeout does not prove release. If cleanup remains unknown, preserve the recovery record and report the original session ID and blocker instead of claiming success.

Human control is a special case: retain cleanup responsibility but do not automatically stop an active handoff. Confirm handback or session expiry, then complete cleanup according to the reference.

Report the page result, resource release and billing separately. Use settled `billing.actual_charge_centipoints / 100` for actual points (积分). Centipoints are subunits of service points, not dollars or yuan: for example 125 centipoints = 1.25 points, with no currency symbol. `waived` for confirmed waiver, and unknown/pending for other states. Do not equate resource release with billing settlement or profile save. Use profiles only if persistence is requested; verify save status separately. Disabling/uninstalling the extension does not stop cloud resources or revoke credentials.
