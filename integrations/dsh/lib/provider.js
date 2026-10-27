import { createScope } from '@deepseek-ai/dsh-scope';
import * as McpClient from '@deepseek-ai/dsh-mcp-client';
/** Wait for cleanup without preventing cancellation of a later turn. */
async function waitForCleanup(work, signal) {
    signal.throwIfAborted();
    await new Promise((resolve, reject) => {
        const finish = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => { finish(); reject(signal.reason); };
        signal.addEventListener('abort', onAbort, { once: true });
        work.then(() => { finish(); resolve(); }, error => { finish(); reject(error); });
        if (signal.aborted)
            onAbort();
    });
}
/** Per-owner prototype for proving tool admission and resource cleanup. */
export class LocalCapyProvider {
    ctx;
    options;
    states = new Map();
    failuresBySession = new Map();
    sessions = new Map();
    ownerBarriers = new Map();
    spawned = 0;
    closed = 0;
    constructor(ctx, options) {
        this.ctx = ctx;
        this.options = options;
    }
    install() {
        this.ctx.on('agent/created', ({ agent }) => {
            this.sessions.set(agent.session, agent);
            const barrier = createScope(this.ctx, agent);
            this.ownerBarriers.set(agent, barrier);
            barrier.ctx.tools.register({
                name: 'capy_cleanup_barrier', description: 'Internal lifecycle admission.', parameters: { type: 'object', properties: {} },
                output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: '' }] },
                execute: async () => { throw new Error('internal barrier cannot execute'); },
            }, { when: async ({ agent: owner, signal }) => {
                    await this.options.ready;
                    const state = this.states.get(owner);
                    if (state?.closing)
                        await waitForCleanup(state.closing, signal);
                    signal.throwIfAborted();
                    const previousFailure = this.failuresBySession.get(owner.id);
                    if (previousFailure !== undefined)
                        throw new Error('Previous browser cleanup failed; browser operations are blocked.', { cause: previousFailure });
                    return false;
                } });
            agent.ctx.effect(() => async () => {
                try {
                    await this.close(agent);
                }
                finally {
                    this.sessions.delete(agent.session);
                    this.ownerBarriers.delete(agent);
                    await barrier.dispose();
                }
            });
        });
        this.ctx.on('agent/turn-stopping', async ({ agent }) => { await this.close(agent); });
        this.ctx.on('session/event', (session, event) => {
            const agent = this.sessions.get(session);
            if (agent && event.type === 'turn/end')
                void this.close(agent).catch(() => { });
        });
        this.ctx.effect(() => this.ctx.tools.register({
            name: 'capy_start', description: 'Start a bounded Baizhi Cloud Browser session for the current task.', parameters: { type: 'object', properties: {} },
            output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: String(value) }] },
            execute: async (_args, exec) => {
                if (!exec.agent)
                    throw new Error('Agent owner required');
                await this.start(exec.agent, exec.signal);
                return 'browser started';
            },
        }));
        this.ctx.effect(() => async () => {
            const results = await Promise.allSettled([...this.states.keys()].map(agent => this.close(agent)));
            const failures = results.filter((r) => r.status === 'rejected').map(r => r.reason);
            if (failures.length)
                throw new AggregateError(failures, 'Browser cleanup failed during provider disposal');
        });
    }
    async start(agent, signal) {
        signal.throwIfAborted();
        const previousFailure = this.failuresBySession.get(agent.id);
        if (previousFailure !== undefined)
            throw new Error('Previous browser cleanup failed; browser operations are blocked.', { cause: previousFailure });
        const existing = this.states.get(agent);
        if (existing?.phase === 'failed')
            throw new Error('Previous browser cleanup failed; browser operations are blocked.', { cause: existing.failure });
        if (existing?.phase === 'active' || existing?.phase === 'opening' || existing?.phase === 'closing')
            throw new Error('Browser already active or closing');
        const scope = createScope(this.ctx, agent);
        const state = { scope, phase: 'opening', signal };
        this.states.set(agent, state);
        const abort = () => { void this.close(agent).catch(() => { }); };
        state.abort = abort;
        signal.addEventListener('abort', abort, { once: true });
        this.spawned++;
        try {
            await this.options.ready;
            signal.throwIfAborted();
            if (state.phase !== 'opening') throw new Error('Browser closed during startup');
            state.openingWork = Promise.resolve().then(() => this.options.beforeConnect?.(agent));
            const cdpEndpoint = await state.openingWork;
            signal.throwIfAborted();
            // MCP failures may contain a one-use CDP capability; do not persist raw diagnostics.
            scope.ctx.on('tools/execute', async (exec, next) => {
                if (!exec.name.startsWith('mcp__capy-local__')) return next();
                const result = await next();
                if (result.isError) return { isError: true, error: { message: 'Browser operation failed. Check the existing session and retry only if safe.' }, content: [{ type: 'text', text: 'Browser operation failed. Check the existing session and retry only if safe.' }] };
                const redact = value => typeof value === 'string' ? value.split(cdpEndpoint).join('[redacted control address]') : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,redact(v)])) : value;
                return redact(result);
            });
            await scope.ctx.plugin(McpClient, McpClient.Config({
                transport: 'stdio', serverName: 'capy-local', command: this.options.command,
                args: this.options.args, env: { ...Object.fromEntries(Object.keys(process.env).filter(k => k.toUpperCase().startsWith('PLAYWRIGHT_MCP_')).map(k => [k, ''])), ...(this.options.env ?? {}), ...(cdpEndpoint ? { PLAYWRIGHT_MCP_CDP_ENDPOINT: cdpEndpoint } : {}) }, cwd: this.options.cwd,
                failOnStartupError: true, reconnect: { enabled: false },
            }));
            signal.throwIfAborted();
            if (state.phase !== 'opening')
                throw new Error('Browser closed during startup');
            state.phase = 'active';
        }
        catch (error) {
            try {
                await this.close(agent);
            }
            catch (cleanupError) {
                throw new Error('Browser startup and cleanup failed; check the existing session.');
            }
            throw new Error('Browser startup failed; check the existing session.');
        }
    }
    close(agent) {
        const state = this.states.get(agent);
        if (!state || state.phase === 'closed')
            return Promise.resolve();
        if (state.closing)
            return state.closing;
        if (state.phase === 'failed')
            return Promise.reject(state.failure);
        state.phase = 'closing';
        if (state.signal && state.abort)
            state.signal.removeEventListener('abort', state.abort);
        const work = (async () => {
            const failures = [];
            // Acquisition may have persisted an uncertain create; wait before recovery.
            if (state.openingWork) await state.openingWork.catch(() => {});
            try {
                await this.options.beforeDisconnect?.(agent);
            }
            catch (error) {
                failures.push(error);
            }
            try {
                await state.scope.dispose();
            }
            catch (error) {
                failures.push(error);
            }
            try {
                await this.options.afterDisconnect?.(agent);
            }
            catch (error) {
                failures.push(error);
            }
            if (failures.length) {
                const error = new AggregateError(failures, '百智云浏览器清理失败，运行可能仍在计费。请在控制台检查并停止原运行。');
                state.failure = error;
                state.phase = 'failed';
                this.failuresBySession.set(agent.id, error);
                this.options.onCleanupFailure?.(agent);
                throw error;
            }
            state.phase = 'closed';
            this.closed++;
        })();
        state.closing = work;
        return work;
    }
    async shutdown() {
        const results = await Promise.allSettled([...this.states.keys()].map(agent => this.close(agent)));
        if (results.some(result => result.status === 'rejected')) throw new Error('Browser cleanup failed during shutdown');
    }
    stats() {
        return { spawned: this.spawned, closed: this.closed, live: [...this.states.values()].filter(s => s.phase !== 'closed').length };
    }
}
