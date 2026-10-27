import { LocalCapyProvider } from './provider.js'
import { CloudContractFixture } from './cloud-fixture.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export const inject = ['tools', 'agents', 'browserUse']
export async function apply(ctx, config) {
  if (!config?.stateDir || !config?.apiKeyEnv) throw new Error('stateDir and apiKeyEnv are required')
  let durable, provider, startupBlocked = false, manuallyAcknowledged = false
  const alerted = new Set(), recoveryTokens = new Map()
  // Optional Web/desktop capability. The route uses the same authentication gate
  // as DSH's other local browser APIs, and never returns credentials or CDP URLs.
  ctx.inject(['webServer', 'connection'], web => {
    web.effect(() => web.webServer.register({
      kind: 'exact', path: '/api/baizhi-browser-status', handler: (req, res) => {
        const admission = web.connection.admit(req)
        if ('rejection' in admission) { res.statusCode = admission.rejection; res.end(); return }
        if (admission.peer.id !== web.connection.browserPeer.id) { res.statusCode = 403; res.end(); return }
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        let records = []
        try {
          if (durable) records = durable.records()
          else if (existsSync(join(config.stateDir, 'recovery.sqlite'))) {
            const db = new DatabaseSync(join(config.stateDir, 'recovery.sqlite'), { readOnly: true })
            try { records = db.prepare('SELECT owner,session_id FROM operations').all() } finally { db.close() }
          }
        } catch { startupBlocked = true }
        const pending = records.filter(row => startupBlocked || alerted.has(row.owner)).map(row => {
          const unknown = row.session_id == null
          let token = null
          if (unknown && durable && typeof row.request_key === 'string') {
            token = [...recoveryTokens].find(([, value]) => value.owner === row.owner && value.requestKey === row.request_key)?.[0]
            if (!token) { token = randomUUID(); recoveryTokens.set(token, { owner: row.owner, requestKey: row.request_key }) }
          }
          return { sessionId: typeof row.session_id === 'string' ? row.session_id : null, createdAt: typeof row.created_at === 'string' ? row.created_at : null, token }
        })
        const data = { blocked: startupBlocked || pending.length > 0, pending, restartRequired: manuallyAcknowledged && pending.length === 0 }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data))
      },
    }), 'baizhi-browser.status')
    web.effect(() => web.webServer.register({
      kind: 'exact', path: '/api/baizhi-browser-confirm-unknown', handler: async (req, res) => {
        const reject = code => { res.writeHead(code, { 'cache-control': 'no-store' }); res.end() }
        const admission = web.connection.admit(req)
        if ('rejection' in admission) return reject(admission.rejection)
        if (admission.peer.id !== web.connection.browserPeer.id) return reject(403)
        if (req.method !== 'POST') return reject(405)
        let origin
        try { origin = new URL(req.headers.origin) } catch { return reject(403) }
        if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol) || !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return reject(403)
        let chunks = '', payload
        try {
          for await (const chunk of req) { chunks += chunk.toString('utf8'); if (chunks.length > 1024) return reject(413) }
          payload = JSON.parse(chunks)
        } catch { return reject(400) }
        if (payload?.confirmed !== 'checked-console-not-release-proof' || typeof payload?.token !== 'string') return reject(400)
        const record = recoveryTokens.get(payload.token)
        if (!durable || !record || !(startupBlocked || alerted.has(record.owner))) return reject(409)
        try { await durable.acknowledgeUnknown(record.owner, record.requestKey) } catch { return reject(409) }
        recoveryTokens.delete(payload.token); alerted.delete(record.owner); startupBlocked = true; manuallyAcknowledged = true
        if (provider) { provider.options.ready = Promise.reject(new Error('已确认本地记录，请重新启用插件。')); void provider.options.ready.catch(() => {}) }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ accepted: true, restartRequired: true, cloudReleaseVerified: false }))
      },
    }), 'baizhi-browser.confirm-unknown')
  })
  const fixture = config.fixture ?? { endpoint: 'https://capybrowser.app.baizhi.cloud' }
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js')
  const mcp = config.mcp ?? { command: process.execPath, args: [cli, '--browser', 'chromium'], cwd: process.cwd() }
  const apiKey = process.env[config.apiKeyEnv]
  try { durable = await CloudContractFixture.open({ ...fixture, apiKey, directory: config.stateDir, maxSeconds: config.maxSeconds ?? 180, warn: message => ctx.logger.error(message) }) }
  catch {
    startupBlocked = true
    ctx.logger.error('百智云浏览器无法确认账户或恢复状态。请检查配置与控制台中的原运行。')
    return
  }
  let ready = durable.recover()
  try { await ready } catch {
    startupBlocked = true
    // Keep the plugin and its status surface alive; no browser admission can pass.
    ready = Promise.reject(new Error('百智云浏览器恢复失败，请在控制台检查原运行。'))
    void ready.catch(() => {})
  }
  provider = new LocalCapyProvider(ctx, {
    ...mcp, ready,
    beforeConnect: agent => durable.prepare(agent.id),
    afterDisconnect: async agent => { await durable.cleanup(agent.id); alerted.delete(agent.id) },
    onCleanupFailure: agent => {
      alerted.add(agent.id)
      ctx.logger.error('百智云浏览器清理失败，请在控制台检查原运行。')
    },
  })
  ctx.browserUse.register('baizhi-cloud-browser-local')
  provider.install()
  ctx.effect(() => async () => { try { await provider.shutdown() } finally { durable.close() } })
}
