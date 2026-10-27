window.__ModuleLoader__.load({
  id: 'dsh-baizhi-cloud-browser',
  factory: (require) => {
    const React = require('react')
    const listeners = new Set()
    let snapshot = { blocked: false, pending: [], restartRequired: false }
    const source = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
    const Banner = ({ useStatus }) => {
      const status = useStatus(value => value)
      const [failed, setFailed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      if (!status.blocked) return null
      const confirmUnknown = async token => {
        const message = '请先在百智云浏览器控制台按记录时间核对，并停止可能相关的运行。\n\n确认后只解除这一条本地阻断，不代表云端已释放，也不代表费用已结算。尚未确认时请取消并联系支持。'
        if (!window.confirm(message)) return
        setBusy(true); setFailed(false)
        try {
          const result = await fetch('/api/baizhi-browser-confirm-unknown', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, confirmed: 'checked-console-not-release-proof' }) })
          if (!result.ok) throw new Error('confirmation rejected')
        } catch { setFailed(true) } finally { setBusy(false) }
      }
      const rows = status.pending.map((item, index) => React.createElement('li', { key: item.token ?? item.sessionId ?? index },
        item.sessionId ? `原运行：${item.sessionId}` : `原运行编号未知；记录时间：${item.createdAt ?? '不可用'}`,
        !item.sessionId && item.token ? React.createElement('button', { type: 'button', disabled: busy, onClick: () => confirmUnknown(item.token), style: { display: 'block', marginTop: 6 } }, '已在控制台核对，处理此记录') : null))
      return React.createElement('div', { role: 'alert', 'data-baizhi-cleanup-alert': true, style: { pointerEvents: 'auto', position: 'fixed', top: 12, right: 12, zIndex: 9999, maxWidth: 460, padding: 14, borderRadius: 8, background: '#fff2d7', color: '#412600', border: '1px solid #9f6600', boxShadow: '0 4px 18px #0003' } },
        React.createElement('strong', null, status.restartRequired ? '本地记录已处理，请重新启用插件' : '百智云浏览器运行未确认结束'),
        React.createElement('p', null, status.restartRequired ? '这只记录了你的核对确认，不能证明云运行已释放或费用已结算。重新启用插件后才能继续。' : '清理失败或恢复受阻，运行可能仍在计费。请在控制台检查并停止本插件创建的原运行。'),
        React.createElement('ul', null, ...rows),
        failed ? React.createElement('p', { role:'status' }, '无法处理该记录，请检查当前账户与网络后重试；不确定时联系支持。') : null,
        React.createElement('a', { href: 'https://capybrowser.app.baizhi.cloud/', target: '_blank', rel: 'noreferrer' }, '打开百智云浏览器控制台'))
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        let stopped = false
        const refresh = async () => {
          try {
            const response = await fetch('/api/baizhi-browser-status', { credentials: 'same-origin', cache: 'no-store' })
            if (!response.ok) return
            const data = await response.json()
            if (stopped || typeof data.blocked !== 'boolean' || !Array.isArray(data.pending)) return
            if (JSON.stringify(data) !== JSON.stringify(snapshot)) { snapshot = data; for (const fn of listeners) fn() }
          } catch { /* Host may still be starting; retry. */ }
        }
        const timer = setInterval(refresh, 1000); void refresh()
        ctx.effect(() => () => { stopped = true; clearInterval(timer); listeners.clear() })
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'baizhi-browser.cleanup-alert', inject: () => ({ hooks: { status: source } }) }, Banner))
      },
    }
  },
})
