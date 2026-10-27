import { createHash } from 'node:crypto'
import { DurableFixture } from './durable.js'

// Production response shape is verified; this implementation remains local-only.
export class CloudContractFixture extends DurableFixture {
  static async open({ directory, endpoint, apiKey, warn, maxSeconds = 180 }) {
    const url = new URL(endpoint)
    if (!((url.protocol === 'http:' && url.hostname === '127.0.0.1') || (url.protocol === 'https:' && url.hostname === 'capybrowser.app.baizhi.cloud' && !url.port)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Untrusted management endpoint')
    if (!apiKey) throw new Error('API key is required')
    let response
    try { response = await fetch(url.origin + '/openapi/v1/me', { headers: { authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(2000) }) }
    catch { throw new Error('Local identity request failed') }
    if (!response.ok) throw new Error('Local identity request failed')
    let body; try { body = await response.json() } catch { throw new Error('Local identity response invalid') }
    const identity = CloudContractFixture.identity(body, url.origin)
    const instance = new CloudContractFixture({directory, endpoint, identity, warn, maxSeconds})
    instance.apiKey = apiKey
    return instance
  }
  static identity(response, origin = 'http://127.0.0.1') {
    const d=response?.data, i=d?.identity, c=d?.credential
    if (d?.ok !== true || i?.namespace !== 'capybrowser-auth-v1' || typeof i.user_id !== 'string' || !i.user_id || !['personal','team'].includes(i.scope) ||
      (i.scope === 'team' ? typeof i.team_id !== 'string' || !i.team_id : i.team_id != null) || !['api_key','gateway'].includes(c?.source) || (c.source === 'gateway' ? c.reference != null : c.reference != null && (typeof c.reference !== 'string' || !/^keyref_[0-9a-f]{32}$/.test(c.reference))))
      throw new Error('Account or credential ownership cannot be confirmed')
    return createHash('sha256').update(JSON.stringify([origin,i.namespace,i.user_id,i.team_id ?? null,i.scope])).digest('hex')
  }
  async request(path, method = 'GET', body, key) {
    let response
    try {
      response = await fetch(this.endpoint + path, {method, redirect:'error', signal:AbortSignal.timeout(15000), headers:{
        authorization:`Bearer ${this.apiKey}`, ...(body ? {'content-type':'application/json'} : {}), ...(key ? {'Idempotency-Key':key} : {}),
      }, ...(body ? {body:JSON.stringify(body)} : {})})
    } catch { throw new Error('Local management request failed') }
    if (!response.ok) throw new Error(`Local management request failed (${response.status})`)
    try { const result = await response.json(); if (result?.code && result.code !== 'ok') throw new Error('Management operation rejected'); return result } catch { throw new Error('Local management response invalid') }
  }
  async verify() {
    const actual = CloudContractFixture.identity(await this.request('/openapi/v1/me'), this.endpoint)
    if (actual !== this.identity) throw new Error('Account or credential ownership changed')
  }
  async prepare(owner) {
    const id = await this.create(owner)
    let ready = false
    for (let i = 0; i < 90; i++) {
      const response = await this.request(`/openapi/v1/browser/sessions/${encodeURIComponent(id)}`)
      const status = response?.data?.status
      const expiry = response?.data?.expires_at
      if (expiry !== undefined && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now())) throw new Error('Browser session expiry invalid or elapsed')
      if (status === 'ready') { ready = true; break }
      if (status !== 'starting') throw new Error('Browser session did not become ready')
      await new Promise(r => setTimeout(r,1000))
    }
    if (!ready) throw new Error('Browser readiness timed out')
    const control = await this.request(`/openapi/v1/browser/sessions/${encodeURIComponent(id)}/control`,'POST',{})
    let url
    try { url = new URL(control?.data?.cdp_url) } catch { throw new Error('Local CDP endpoint invalid') }
    if (!((['http:','ws:'].includes(url.protocol) && url.hostname === '127.0.0.1') || (url.protocol === 'wss:' && url.hostname === 'capybrowser.app.baizhi.cloud' && !url.port)) || url.username || url.password) throw new Error('Only a local CDP endpoint is supported')
    return url.href
  }
}
