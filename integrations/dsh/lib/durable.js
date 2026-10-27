import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

// This transport is intentionally restricted to the synthetic test service.
export class DurableFixture {
  constructor({ directory, endpoint, identity, warn = () => {}, maxSeconds = 180 }) {
    const url = new URL(endpoint)
    if (!((url.protocol === 'http:' && url.hostname === '127.0.0.1') || (url.protocol === 'https:' && url.hostname === 'capybrowser.app.baizhi.cloud' && !url.port)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Untrusted management endpoint')
    if (!Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > 180) throw new Error('maxSeconds must be 1 to 180')
    this.maxSeconds=maxSeconds
    if (!identity || !/^[a-zA-Z0-9-]{1,80}$/.test(identity)) throw new Error('Fixture identity required')
    this.endpoint = url.origin; this.identity = identity; this.warn = warn
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700)
    this.lock = new DatabaseSync(join(directory, 'owner-lock.sqlite'))
    try { this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE') }
    catch { this.lock.close(); throw new Error('Recovery state is already owned by another process') }
    try {
      this.db = new DatabaseSync(join(directory, 'recovery.sqlite'))
      chmodSync(join(directory, 'recovery.sqlite'), 0o600)
      this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS operations (owner TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, session_id TEXT, fixture_id TEXT NOT NULL, created_at TEXT);
        CREATE TABLE IF NOT EXISTS manual_resolutions (request_digest TEXT NOT NULL, owner_digest TEXT NOT NULL, resolved_at TEXT NOT NULL, outcome TEXT NOT NULL)` )
      if (!this.db.prepare('PRAGMA table_info(operations)').all().some(column => column.name === 'created_at')) this.db.exec('ALTER TABLE operations ADD COLUMN created_at TEXT')
    } catch (e) { this.lock.exec('ROLLBACK'); this.lock.close(); throw e }
  }
  async request(path, method = 'GET', body, key) {
    const res = await fetch(this.endpoint + path, { method, redirect: 'error', signal: AbortSignal.timeout(2000),
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    if (!res.ok) throw new Error(`fixture HTTP ${res.status}`)
    return res.json()
  }
  async verify() {
    const data = await this.request('/fixture/identity')
    if (data.identity !== this.identity) throw new Error('Fixture identity mismatch; recovery blocked')
  }
  records() { return this.db.prepare('SELECT * FROM operations').all() }
  async resolve(row, allowCreate = false) {
    if (row.fixture_id !== this.identity) throw new Error('Recorded fixture identity mismatch; recovery blocked')
    if (row.session_id) return row.session_id
    // Unknown create outcomes are never replayed by cleanup or after restart.
    if (!allowCreate) throw new Error('Create outcome unknown; inspect the original run before taking further action')
    const data = await this.request('/openapi/v1/browser/sessions', 'POST', { max_seconds: this.maxSeconds }, row.request_key)
    if (!data?.data?.session_id || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.data.session_id)) throw new Error('Invalid fixture session response')
    this.db.prepare('UPDATE operations SET session_id=? WHERE owner=?').run(data.data.session_id, row.owner)
    return data.data.session_id
  }
  async create(owner) {
    await this.verify()
    if (this.db.prepare('SELECT owner FROM operations WHERE owner=?').get(owner)) throw new Error('Previous browser operation requires cleanup')
    const key = randomUUID()
    this.db.prepare('INSERT INTO operations(owner, request_key, fixture_id, created_at) VALUES(?,?,?,?)').run(owner, key, this.identity, new Date().toISOString())
    const row=this.db.prepare('SELECT * FROM operations WHERE owner=?').get(owner)
    try { return await this.resolve(row, true) }
    catch { return await this.resolve(row, true) }
  }
  async cleanup(owner) {
    const row = this.db.prepare('SELECT * FROM operations WHERE owner=?').get(owner)
    if (!row) return
    try {
      await this.verify()
      const id = await this.resolve(row)
      await this.request(`/openapi/v1/browser/sessions/${encodeURIComponent(id)}`, 'DELETE')
      let released = false
      for (let i = 0; i < 30; i++) {
        const result = await this.request(`/openapi/v1/browser/sessions/${encodeURIComponent(id)}`)
        if (result?.data?.status === 'released') {
          released = true
          const b = result?.data?.billing
          this.db.exec('CREATE TABLE IF NOT EXISTS receipts (owner TEXT, session_id TEXT, release_status TEXT, billing_status TEXT, actual_charge_centipoints INTEGER)')
          this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(owner,id,'released',typeof b?.status === 'string' ? b.status : 'unknown',Number.isSafeInteger(b?.actual_charge_centipoints) ? b.actual_charge_centipoints : null)
          break
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      if (!released) throw new Error('Release confirmation timed out')
      this.db.prepare('DELETE FROM operations WHERE owner=?').run(owner)
    } catch (error) {
      // Never expose raw HTTP data or user-supplied errors to the log.
      this.warn('Browser cleanup failed or release is unconfirmed; the recovery record was retained and browser operations are blocked.')
      throw new Error('Browser cleanup failed; recovery is required')
    }
  }
  async acknowledgeUnknown(owner, requestKey) {
    await this.verify()
    const record = this.db.prepare('SELECT * FROM operations WHERE owner=? AND request_key=?').get(owner, requestKey)
    if (!record || record.session_id !== null || record.fixture_id !== this.identity) throw new Error('Record cannot be acknowledged')
    const digest = value => createHash('sha256').update(value).digest('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare('DELETE FROM operations WHERE owner=? AND request_key=? AND session_id IS NULL AND fixture_id=?').run(owner, requestKey, this.identity)
      if (result.changes !== 1) throw new Error('Record changed')
      this.db.prepare('INSERT INTO manual_resolutions VALUES(?,?,?,?)').run(digest(requestKey), digest(owner), new Date().toISOString(), 'user_confirmed_checked_not_release_proof')
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  async recover() {
    for (const row of this.records()) await this.cleanup(row.owner)
  }
  close() { this.db.close(); this.lock.exec('ROLLBACK'); this.lock.close() }
}
