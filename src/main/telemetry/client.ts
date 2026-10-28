import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  LIMITS,
  registerOutput,
  telemetryError,
  telemetryEvent,
  type DeviceInfo,
  type ErrorSource,
  type Props,
  type TelemetryError,
  type TelemetryEvent,
} from './contract'
import { truncate } from './scrub'

export const SETTINGS = {
  enabled: 'telemetry.enabled',
  token: 'telemetry.token',
  /** Digest of the DeviceInfo the server last accepted, so it is resent only when it changes. */
  deviceHash: 'telemetry.deviceHash',
  /** Random id used when the OS hardware id cannot be read. */
  fallbackId: 'telemetry.fallbackId',
  pending: 'telemetry.pending',
} as const

export type SettingsStore = {
  getSetting<T>(key: string, schema: z.ZodType<T>): T | null
  setSetting(key: string, value: unknown): void
}

export type Identity = { deviceId: string; device: DeviceInfo }

export type ClientDeps = {
  baseUrl: string
  appVersion: string
  store: SettingsStore
  identify: () => Promise<Identity>
  scrub?: (text: string) => string
  fetch?: typeof fetch
  now?: () => Date
  sessionId?: string
  timeoutMs?: number
}

export type ErrorInput = { source: ErrorSource; name: string; message: string; stack?: string | undefined; context?: Props }

type Batch = { sessionId: string; appVersion: string; events: TelemetryEvent[]; errors: TelemetryError[] }

const pendingSchema = z.array(
  z.object({ sessionId: z.uuid(), appVersion: z.string(), events: z.array(telemetryEvent), errors: z.array(telemetryError) }),
)
/** Unsent batches kept across restarts, one per past session. */
const MAX_CARRIED = 3

export const hashJson = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export const eventName = (raw: string) => raw.replace(/[^a-z0-9_.:-]/gi, '_').slice(0, LIMITS.eventName) || 'unknown'

export function cleanProps(props: Props, scrub: (text: string) => string = (t) => t): Props {
  const out: Props = {}
  for (const [key, value] of Object.entries(props).slice(0, LIMITS.props)) {
    out[key.slice(0, LIMITS.key)] = typeof value === 'string' ? truncate(scrub(value), LIMITS.text) : value
  }
  return out
}

/** Keeps the newest `max`; the queue drops its oldest items first. */
const capped = <T>(items: T[], max: number) => (items.length > max ? items.slice(items.length - max) : items)

/**
 * Queues analytics events and error reports and ships them in batches. Every failure is swallowed:
 * telemetry must never surface in the app.
 */
export class TelemetryClient {
  private events: TelemetryEvent[] = []
  private errors: TelemetryError[] = []
  private counts = new Map<string, number>()
  /** Items earlier runs could not send, each still under its own session. */
  private carried: Batch[]
  private token: string | null
  private enabled: boolean
  private identity: Promise<Identity> | null = null
  private inFlight: Promise<void> | null = null
  private readonly sessionId: string
  private readonly fetch: typeof fetch
  private readonly now: () => Date
  private readonly scrub: (text: string) => string

  constructor(private readonly deps: ClientDeps) {
    this.sessionId = deps.sessionId ?? randomUUID()
    this.fetch = deps.fetch ?? ((...args) => globalThis.fetch(...args))
    this.now = deps.now ?? (() => new Date())
    this.scrub = deps.scrub ?? ((text) => text)
    this.enabled = deps.store.getSetting(SETTINGS.enabled, z.boolean()) ?? true
    this.token = deps.store.getSetting(SETTINGS.token, z.string())
    this.carried = (this.enabled ? deps.store.getSetting(SETTINGS.pending, pendingSchema) : null) ?? []
    deps.store.setSetting(SETTINGS.pending, null)
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.deps.store.setSetting(SETTINGS.enabled, enabled)
    if (!enabled) this.clear()
  }

  /** Registers up front when no token is stored yet. */
  async start(): Promise<void> {
    if (!this.enabled || this.token) return
    await this.withIdentity((identity) => this.register(identity)).catch(() => null)
  }

  track(name: string, props?: Props): void {
    if (!this.enabled) return
    this.events = capped([...this.events, this.event(name, props)], LIMITS.events)
  }

  /** Coalesced: each name becomes one event per flush with `props.count`. */
  count(name: string): void {
    if (!this.enabled) return
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1)
  }

  error({ source, name, message, stack, context }: ErrorInput): void {
    if (!this.enabled) return
    const entry: TelemetryError = {
      source,
      name: truncate(this.scrub(name) || 'Error', LIMITS.name),
      message: truncate(this.scrub(message), LIMITS.message),
      ...(stack ? { stack: truncate(this.scrub(stack), LIMITS.stack) } : {}),
      ...(context ? { context: cleanProps(context, this.scrub) } : {}),
      at: this.now().toISOString(),
    }
    this.errors = capped([...this.errors, entry], LIMITS.errors)
  }

  /** Never rejects; concurrent calls share one in-flight send. */
  flush(): Promise<void> {
    this.inFlight ??= this.send()
      .catch(() => {})
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  /** Saves what is still queued so the next run can send it. */
  persist(): void {
    if (!this.enabled) return
    this.drainCounts()
    const own = this.events.length || this.errors.length ? [this.current()] : []
    this.deps.store.setSetting(SETTINGS.pending, capped([...this.carried, ...own], MAX_CARRIED))
  }

  /** What is queued right now, counters included. Exposed for tests. */
  queued(): { events: TelemetryEvent[]; errors: TelemetryError[]; counts: Record<string, number> } {
    return { events: [...this.events], errors: [...this.errors], counts: Object.fromEntries(this.counts) }
  }

  private clear(): void {
    this.events = []
    this.errors = []
    this.counts.clear()
    this.carried = []
    this.deps.store.setSetting(SETTINGS.pending, null)
  }

  private event(name: string, props?: Props): TelemetryEvent {
    return { name: eventName(name), ...(props ? { props: cleanProps(props, this.scrub) } : {}), at: this.now().toISOString() }
  }

  private drainCounts(): void {
    if (this.counts.size === 0) return
    const coalesced = [...this.counts].map(([name, count]) => this.event(name, { count }))
    this.counts.clear()
    this.events = capped([...this.events, ...coalesced], LIMITS.events)
  }

  private current(): Batch {
    return { sessionId: this.sessionId, appVersion: this.deps.appVersion, events: this.events, errors: this.errors }
  }

  private withIdentity<T>(fn: (identity: Identity) => Promise<T>): Promise<T> {
    this.identity ??= this.deps.identify()
    return this.identity.then(fn)
  }

  private async send(): Promise<void> {
    if (!this.enabled) return
    this.drainCounts()
    const carried = this.carried
    this.carried = []
    for (const batch of carried) {
      if ((await this.withIdentity((identity) => this.ingest(identity, batch))) === 'retry' && this.enabled) this.carried.push(batch)
    }
    if (this.events.length === 0 && this.errors.length === 0) return
    const batch = this.current()
    this.events = []
    this.errors = []
    if ((await this.withIdentity((identity) => this.ingest(identity, batch))) === 'retry' && this.enabled) {
      // Anything queued meanwhile is newer, so it stays last and survives the cap.
      this.events = capped([...batch.events, ...this.events], LIMITS.events)
      this.errors = capped([...batch.errors, ...this.errors], LIMITS.errors)
    }
  }

  /** 'drop' is a batch the server will never take, so it is not retried. */
  private async ingest(identity: Identity, batch: Batch): Promise<'ok' | 'retry' | 'drop'> {
    try {
      let token = this.token ?? (await this.register(identity))
      if (!token) return 'retry'
      const deviceHash = hashJson(identity.device)
      const sendDevice = deviceHash !== this.deps.store.getSetting(SETTINGS.deviceHash, z.string())
      const body = { deviceId: identity.deviceId, ...batch, ...(sendDevice ? { device: identity.device } : {}) }
      let res = await this.post('/api/telemetry/ingest', body, token)
      if (res.status === 401) {
        token = await this.register(identity)
        if (!token) return 'retry'
        res = await this.post('/api/telemetry/ingest', body, token)
      }
      if (res.ok) {
        if (sendDevice) this.deps.store.setSetting(SETTINGS.deviceHash, deviceHash)
        return 'ok'
      }
      return res.status >= 500 || res.status === 401 || res.status === 429 ? 'retry' : 'drop'
    } catch {
      return 'retry'
    }
  }

  /** Registering again for a known device rotates its token. */
  private async register({ deviceId, device }: Identity): Promise<string | null> {
    try {
      const res = await this.post('/api/telemetry/register', { deviceId, device })
      if (!res.ok) return null
      const { token } = registerOutput.parse(await res.json())
      this.token = token
      this.deps.store.setSetting(SETTINGS.token, token)
      this.deps.store.setSetting(SETTINGS.deviceHash, hashJson(device))
      return token
    } catch {
      return null
    }
  }

  private post(path: string, body: unknown, token?: string): Promise<Response> {
    return this.fetch(new URL(path, this.deps.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.deps.timeoutMs ?? 10_000),
    })
  }
}
