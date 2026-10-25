# Baizhi Cloud Browser provider for agent-browser

This package lets `agent-browser` use a Session hosted by Baizhi Cloud Browser (CapyBrowser) as its remote CDP browser. The service creates and owns the browser; `agent-browser` keeps its existing page commands for navigation, snapshots, clicks, and form input.

## Requirements

- Node.js 24 or newer.
- `agent-browser` 0.38.2 (the version used for local acceptance; install it separately as shown below).
- An HTTPS API endpoint and API Key for Baizhi Cloud Browser. HTTP is accepted only for explicit loopback fixtures (`localhost`, `127.0.0.0/8`, or `::1`); URL userinfo is rejected.

## Install

Install the tested `agent-browser` version first:

```sh
npm install --global agent-browser@0.38.2
```

Download the `agent-browser-plugin-capybrowser-0.1.3.tgz` asset from the GitHub `v0.1.3` release, verify its SHA-256 against the release notes, and install the downloaded file. This workflow does not require a registry release of this plugin:

```sh
shasum -a 256 ./agent-browser-plugin-capybrowser-0.1.3.tgz
npm install --global ./agent-browser-plugin-capybrowser-0.1.3.tgz
```

To build the same package from this source directory, install the locked development dependencies and create a local tgz:

```sh
npm ci
npm pack
npm install --global ./agent-browser-plugin-capybrowser-0.1.3.tgz
```

Register the installed executable in the project-level `agent-browser.json`:

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

Keep the API Key in the environment or a secret manager. Do not place it in `agent-browser.json` or command arguments.

```sh
export CAPYBROWSER_BASE_URL="https://your-capybrowser-host"
export CAPYBROWSER_API_KEY="<your-api-key>"
# Optional: bind a new Session to an existing Baizhi Cloud Browser Profile.
export CAPYBROWSER_PROFILE_ID="prof_..."
# Optional: set the maximum run duration in seconds (1–7000).
export CAPYBROWSER_MAX_SECONDS="900"
```

## Use a browser Session

Choose a distinct agent-browser session name for each task. The same name reconnects to the same Session in Baizhi Cloud Browser.

```sh
agent-browser --session research-1 --provider capy open https://example.com
agent-browser --session research-1 snapshot -i
agent-browser --session research-1 click @e1
```

When a CDP connection drops, retry the same task name. The provider asks Baizhi Cloud Browser for a fresh control URL for the existing Session; it does not create a replacement Session. Keep the endpoint, API Key, Profile, and maximum duration settings used when that task first launched. If they change, restore the original settings before inspect, retry, or end. The saved state contains a credential fingerprint, never the API Key.

`agent-browser close` closes its local CDP connection. A failed CDP attach also leaves the Session running in Baizhi Cloud Browser; usage charges may continue. Inspect and explicitly end a Session created by this provider:

```sh
agent-browser --session research-1 --provider capy close
agent-browser plugin run capy capy.session.inspect --payload '{"session":"research-1"}'
agent-browser plugin run capy capy.session.end --payload '{"session":"research-1"}'
```

`capy.session.end` exits nonzero while the stop request, resource release, or billing result remains unresolved, and for `review_required`. Its 50-second total budget starts before waiting for the task's state lock; unfinished HTTP requests and response reads are aborted when their remaining budget expires. A pending result reports the last confirmed facts, including whether the lock was acquired and whether DELETE acceptance is known. Run inspect, then retry the same end command; a recorded accepted DELETE is not repeated, including when only billing remains pending. For a full JSON report even on a pending result, run `capy-agent-browser-session end research-1` (exit 2 means follow-up is needed). `capy.session.inspect` also reports the confirmed charge stop time when available. `browser.close` cannot trigger cleanup by itself because agent-browser invokes that callback for explicit close, failed attach, and reconnect. After ending a Session, a later `agent-browser close` may fail because agent-browser attempts provider launch against the terminal task state; detach before `capy.session.end`.

The report keeps `end_accepted`, `charge_stop_at`, `expires_at`, `released`, and billing status separate. The service determines charge stop from its accepted DELETE/`charge_stop_at` or Session expiry. `released` confirms resource release; `settled` and `waived` are distinct final billing outcomes. A delayed settlement does not itself mean usage charges continue. If billing is `review_required`, resolve the service review before treating the run as closed.

## Retrieve a browser download

Trigger the website's download while the Session in Baizhi Cloud Browser is still `ready`, then retrieve the resulting artifact **before** ending it. The remote browser and your machine do not share a filesystem. In this provider, `agent-browser download <selector> <local-path>` can observe the browser download yet exit nonzero when its local-save step cannot find the remote file. A click or that CLI exit alone does not prove file delivery. Check the Session download list for an item with `state=ready`, fetch its content, and verify its size and SHA-256.

Use the site's actual download link selector. The following command triggers the browser download and tries to save it locally; its exit code is not the delivery result. If it exits nonzero because the remote file is unavailable at the local path, inspect the Baizhi Cloud Browser artifact list before deciding whether delivery succeeded. Do not retry the website action blindly when its outcome is unknown.

The current provider has no `command.run` download-list or download-content command. Use the same API Key with the documented Baizhi Cloud Browser artifact API. In this example, copy the Session ID from `capy.session.inspect` and a **ready** download ID from the list; keep the Key in the environment, never in the command arguments or output:

```sh
agent-browser --session research-1 --provider capy download 'a[download]' ./local-attempt.bin
agent-browser plugin run capy capy.session.inspect --payload '{"session":"research-1"}'
SESSION_ID='sess_...'
CAPYBROWSER_API_ROOT="$(node -e '
const url = new URL(process.env.CAPYBROWSER_BASE_URL);
const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
  throw new Error("Use a credential-free HTTPS Baizhi Cloud Browser URL (HTTP only for loopback fixtures)");
}
let path = url.pathname.replace(/\/+$/, "");
if (!path.endsWith("/openapi/v1")) path += "/openapi/v1";
url.pathname = path;
process.stdout.write(url.toString().replace(/\/$/, ""));
')" || exit 1
printf 'header = "Authorization: Bearer %s"\n' "$CAPYBROWSER_API_KEY" |
  curl --config - -fsS "$CAPYBROWSER_API_ROOT/browser/sessions/$SESSION_ID/downloads" > capy-downloads.json
# Select an item whose state is ready; its identifier is `id`.
DOWNLOAD_ID='dl_...'
printf 'header = "Authorization: Bearer %s"\n' "$CAPYBROWSER_API_KEY" |
  curl --config - -fsS -D capy-download.headers -o capy-download.bin \
    "$CAPYBROWSER_API_ROOT/browser/sessions/$SESSION_ID/downloads/$DOWNLOAD_ID/content"
wc -c < capy-download.bin
shasum -a 256 capy-download.bin
```

Compare those two values with the list item's `size_bytes` and `sha256`, and with the response's `Content-Length` and `X-Content-SHA256`. A missing item, non-ready state, zero bytes, or mismatch is not a successful download. The content endpoint stops serving the artifact after the Session stops. See the [Baizhi Cloud Browser download API contract](https://capybrowser.app.baizhi.cloud/docs/installation.md#下载文件使用-session-制品接口) for states and limits.

## Attach an existing Session

Set `CAPYBROWSER_SESSION_ID` to use a Session owned by another workflow. This provider will issue control grants for it and will not create a Session. Ending it is refused unless the command explicitly includes `"confirm_existing":true`.

```sh
export CAPYBROWSER_SESSION_ID="<existing-session-id>"
agent-browser --session attached-1 --provider capy open https://example.com
agent-browser --session attached-1 --provider capy close
agent-browser plugin run capy capy.session.end --payload '{"session":"attached-1","confirm_existing":true}'
```

Only confirm ending when the current workflow owns the stop decision. `CAPYBROWSER_PROFILE_ID` and `CAPYBROWSER_SESSION_ID` cannot be set together.

## Local verification

```sh
npm test
npm run test:plugin-cli
npm run test:agent-browser
npm run test:timeout-edge
```

The CLI check uses a local mock Baizhi Cloud Browser API to exercise completion and pending exit codes. The browser check uses local Chrome and a local mock Baizhi Cloud Browser HTTP/CDP service. The timeout check uses the real `agent-browser` CLI with a roughly nine-second same-task lock hold and delayed mock DELETE/GET responses; it takes about 40 seconds. None calls a hosted Baizhi Cloud Browser service.
