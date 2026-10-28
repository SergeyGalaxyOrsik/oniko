import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { z } from 'zod'
import { AGENTS, type AgentId } from '@shared/agents'
import { controlsFromConfigOptions, normalizeConfig, withValue, type LegacyModelState } from '@shared/config'
import type { ThreadEventBody } from '@shared/events'
import type { ConfigControl, ConfigSource } from '@shared/thread'
import { SPAWN_SPECS } from './agent-registry'

const AUTH_REQUIRED = -32000

const legacyModels = z.object({
  models: z
    .object({
      currentModelId: z.string(),
      availableModels: z.array(z.object({ modelId: z.string(), name: z.string(), description: z.string().nullish() })),
    })
    .nullish(),
})

type SessionSetup = { configOptions?: acp.SessionConfigOption[] | null; modes?: acp.SessionModeState | null }

function configFrom(response: SessionSetup): ConfigControl[] {
  const parsed = legacyModels.safeParse(response)
  const models: LegacyModelState | null = parsed.success ? (parsed.data.models ?? null) : null
  return normalizeConfig({ configOptions: response.configOptions, modes: response.modes, models })
}

function isAuthRequired(error: unknown): boolean {
  return error instanceof acp.RequestError && error.code === AUTH_REQUIRED
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Setter = (conn: acp.ClientConnection, sessionId: string, control: ConfigControl, value: string) => Promise<ConfigControl[] | null>

/** How each config source is written back to the agent; null means "keep the controls, just change the value". */
const SETTERS: Record<ConfigSource, Setter> = {
  config_option: async (conn, sessionId, control, value) => {
    const res = await conn.agent.request('session/set_config_option', { sessionId, configId: control.id, value })
    return controlsFromConfigOptions(res.configOptions)
  },
  mode: async (conn, sessionId, _control, value) => {
    await conn.agent.request('session/set_mode', { sessionId, modeId: value })
    return null
  },
  model: async (conn, sessionId, _control, value) => {
    await conn.agent.request('session/set_model', { sessionId, modelId: value })
    return null
  },
}

export type AgentSessionOptions = {
  agentId: AgentId
  cwd: string
  acpSessionId: string | null
  logPath: string
  emit: (event: ThreadEventBody) => void
}

/** One agent process and one ACP session for one thread. */
export class AgentSession {
  private proc: ChildProcess | null = null
  private conn: acp.ClientConnection | null = null
  private log: WriteStream | null = null
  private init: acp.InitializeResponse | null = null
  private ready: Promise<boolean> | null = null
  private acpSessionId: string | null
  private config: ConfigControl[] = []
  private turnStartedAt: number | null = null
  private queuedPrompt: string | null = null
  private suppressUpdates = false
  private disposed = false
  private readonly pending = new Map<string, (outcome: acp.RequestPermissionOutcome) => void>()

  constructor(private readonly opts: AgentSessionOptions) {
    this.acpSessionId = opts.acpSessionId
  }

  /** After dispose the thread is gone or the app is quitting; late failures from the dying process must not reach the store. */
  private emit(event: ThreadEventBody): void {
    if (!this.disposed) this.opts.emit(event)
  }

  /** Spawns and attaches once; concurrent callers share the same attempt. Resolves false when the thread cannot take a prompt. */
  ensureSession(): Promise<boolean> {
    this.ready ??= this.connect().catch((error: unknown) => {
      this.logLine(`connect failed: ${messageOf(error)}`)
      this.emit({ type: 'status', status: { kind: 'error', message: messageOf(error) } })
      this.ready = null
      return false
    })
    return this.ready
  }

  async prompt(text: string): Promise<void> {
    this.emit({ type: 'user_prompt', id: randomUUID(), text })
    if (!(await this.ensureSession())) {
      this.queuedPrompt = text
      return
    }
    await this.runTurn(text)
  }

  async cancel(): Promise<void> {
    for (const resolve of [...this.pending.values()]) resolve({ outcome: 'cancelled' })
    if (this.conn && this.acpSessionId) await this.conn.agent.notify('session/cancel', { sessionId: this.acpSessionId })
  }

  async setConfig(configId: string, value: string): Promise<void> {
    if (!(await this.ensureSession())) return
    const control = this.config.find((c) => c.id === configId)
    if (!control || !this.conn || !this.acpSessionId) return
    try {
      const replaced = await SETTERS[control.source](this.conn, this.acpSessionId, control, value)
      this.config = replaced
        ? [...replaced, ...this.config.filter((c) => c.source !== 'config_option')]
        : withValue(this.config, configId, value)
      this.emit({ type: 'config', config: this.config })
    } catch (error) {
      this.emit({ type: 'notice', level: 'error', text: `Could not change ${control.label}: ${messageOf(error)}` })
    }
  }

  respondPermission(requestId: string, optionId: string | null): void {
    this.pending.get(requestId)?.(optionId === null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId })
  }

  async authenticate(methodId: string): Promise<void> {
    if (!this.conn) return
    try {
      await this.conn.agent.request('authenticate', { methodId })
    } catch (error) {
      this.emit({ type: 'notice', level: 'error', text: `Authentication failed: ${messageOf(error)}` })
      return
    }
    this.emit({ type: 'status', status: { kind: 'connecting' } })
    this.ready = this.attach().catch((error: unknown) => {
      this.emit({ type: 'status', status: { kind: 'error', message: messageOf(error) } })
      this.ready = null
      return false
    })
    if ((await this.ready) && this.queuedPrompt !== null) {
      const text = this.queuedPrompt
      this.queuedPrompt = null
      await this.runTurn(text)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const resolve of [...this.pending.values()]) resolve({ outcome: 'cancelled' })
    this.conn?.close()
    this.proc?.kill()
    this.log?.end()
  }

  private async connect(): Promise<boolean> {
    this.emit({ type: 'status', status: { kind: 'connecting' } })
    const spec = SPAWN_SPECS[this.opts.agentId]()
    this.log ??= createWriteStream(this.opts.logPath, { flags: 'a' })
    const proc = spawn(spec.command, spec.args, {
      cwd: this.opts.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc = proc
    // Adapters log to stderr; keeping it out of stdout keeps the ndjson stream clean.
    proc.stderr?.pipe(this.log, { end: false })
    proc.on('exit', (code) => this.handleExit(proc, code))
    if (!proc.stdin || !proc.stdout) throw new Error('Agent process has no stdio')

    this.conn = acp
      .client({ name: 'oniko' })
      .onNotification('session/update', ({ params }) => {
        if (!this.suppressUpdates) this.emit({ type: 'session_update', update: params.update })
      })
      .onRequest('session/request_permission', ({ params, signal }) => this.askPermission(params, signal))
      .connect(acp.ndJsonStream(Writable.toWeb(proc.stdin), Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>))

    this.init = await this.conn.agent.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    return this.attach()
  }

  private async attach(): Promise<boolean> {
    const conn = this.conn
    if (!conn) return false
    try {
      const res = await conn.agent.request('session/new', { cwd: this.opts.cwd, mcpServers: [] })
      this.attached(res.sessionId, res)
      return true
    } catch (error) {
      if (!isAuthRequired(error)) throw error
      this.emit({ type: 'status', status: { kind: 'auth_required', methods: this.init?.authMethods ?? [] } })
      return false
    }
  }

  private attached(sessionId: string, setup: SessionSetup): void {
    this.acpSessionId = sessionId
    this.config = configFrom(setup)
    this.emit({ type: 'session_attached', acpSessionId: sessionId })
    this.emit({ type: 'config', config: this.config })
    this.emit({ type: 'status', status: { kind: 'idle' } })
  }

  private async runTurn(text: string): Promise<void> {
    const conn = this.conn
    const sessionId = this.acpSessionId
    if (!conn || !sessionId) return
    const startedAt = Date.now()
    this.turnStartedAt = startedAt
    this.emit({ type: 'status', status: { kind: 'running', startedAt } })
    try {
      const res = await conn.agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
      this.emit({ type: 'turn_end', stopReason: res.stopReason, durationMs: Date.now() - startedAt })
    } catch (error) {
      this.emit({ type: 'notice', level: 'error', text: messageOf(error) })
    } finally {
      this.turnStartedAt = null
      if (this.conn === conn) this.emit({ type: 'status', status: { kind: 'idle' } })
    }
  }

  private askPermission(params: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse> {
    const requestId = randomUUID()
    const startedAt = this.turnStartedAt ?? Date.now()
    this.emit({ type: 'permission_request', requestId, toolCall: params.toolCall, options: params.options })
    this.emit({ type: 'status', status: { kind: 'awaiting_permission', requestId, startedAt } })
    return new Promise((resolve) => {
      const settle = (outcome: acp.RequestPermissionOutcome) => {
        if (!this.pending.delete(requestId)) return
        this.emit({
          type: 'permission_resolved',
          requestId,
          outcome: outcome.outcome === 'selected' ? { optionId: outcome.optionId } : 'cancelled',
        })
        if (this.turnStartedAt !== null) {
          this.emit({ type: 'status', status: { kind: 'running', startedAt } })
        }
        resolve({ outcome })
      }
      this.pending.set(requestId, settle)
      signal.addEventListener('abort', () => settle({ outcome: 'cancelled' }), { once: true })
    })
  }

  private handleExit(proc: ChildProcess, code: number | null): void {
    this.logLine(`${AGENTS[this.opts.agentId].label} exited with code ${code}`)
    if (this.proc !== proc) return
    for (const resolve of [...this.pending.values()]) resolve({ outcome: 'cancelled' })
    this.conn?.close()
    this.conn = null
    this.proc = null
    this.ready = null
    this.emit({ type: 'status', status: { kind: 'exited', code } })
  }

  private logLine(line: string): void {
    this.log?.write(`[oniko ${new Date().toISOString()}] ${line}\n`)
  }
}

export function logPathFor(dir: string, threadId: string): string {
  return join(dir, `${threadId}.log`)
}
