import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SETTINGS, TelemetryClient, cleanProps, eventName, type ClientDeps, type SettingsStore } from './client'
import type { DeviceInfo } from './contract'
import { hashDeviceId, parseIoreg, parseMachineId, parseRegQuery } from './device-id'
import { scrub, truncate } from './scrub'

describe('scrub', () => {
  const mac = { home: '/Users/alice', user: 'alice', appPath: '/Applications/Oniko.app/Contents/Resources/app.asar' }

  it('makes app paths relative and hides home and username', () => {
    const stack = [
      'Error: boom',
      '    at f (file:///Applications/Oniko.app/Contents/Resources/app.asar/out/renderer/assets/index.js:1:2)',
      '    at g (/Applications/Oniko.app/Contents/Resources/app.asar/out/main/index.js:3:4)',
      "ENOENT: open '/Users/alice/projects/x'",
      'owner alice, not malice',
    ].join('\n')
    expect(scrub(stack, mac)).toBe(
      ['Error: boom', '    at f (out/renderer/assets/index.js:1:2)', '    at g (out/main/index.js:3:4)', "ENOENT: open '~/projects/x'", 'owner <user>, not malice'].join(
        '\n',
      ),
    )
  })

  it('handles Windows paths in both slash styles', () => {
    const win = { home: 'C:\\Users\\Bob', user: 'Bob', appPath: 'C:\\Program Files\\Oniko\\resources\\app.asar' }
    expect(scrub('at file:///C:/Program Files/Oniko/resources/app.asar/out/main/index.js', win)).toBe('at out/main/index.js')
    expect(scrub('at file:///C:/Program%20Files/Oniko/resources/app.asar/out/a.js', win)).toBe('at out/a.js')
    expect(scrub('C:\\Users\\Bob\\x and C:/Users/Bob/y', win)).toBe('~\\x and ~/y')
  })

  it('leaves one-letter usernames alone', () => {
    expect(scrub('a value', { home: '/home/a', user: 'a', appPath: '/opt/oniko' })).toBe('a value')
  })

  it('truncates with an ellipsis within the limit', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('abc', 4)).toBe('abc')
  })
})

describe('device id', () => {
  it('parses ioreg, reg query and machine-id output', () => {
    expect(parseIoreg('  "IOPlatformSerialNumber" = "C02X"\n  "IOPlatformUUID" = "1A2B-3C4D"\n')).toBe('1A2B-3C4D')
    expect(parseIoreg('nothing')).toBeNull()
    expect(parseRegQuery('\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    abcd-ef01\r\n')).toBe('abcd-ef01')
    expect(parseMachineId('0123abcd\n')).toBe('0123abcd')
    expect(parseMachineId('\n')).toBeNull()
  })

  it('hashes with the salt into the server’s 64-hex shape', () => {
    const id = hashDeviceId('1A2B-3C4D')
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(id).toBe(hashDeviceId('1A2B-3C4D'))
    expect(id).not.toBe(hashDeviceId('1A2B-3C4E'))
  })
})

describe('event shaping', () => {
  it('forces names into the allowed alphabet and length', () => {
    expect(eventName('ipc:threads:create')).toBe('ipc:threads:create')
    expect(eventName('bad name/!')).toBe('bad_name__')
    expect(eventName('x'.repeat(80))).toHaveLength(64)
  })

  it('caps props at 32 keys and 256-char strings', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(300)]))
    const out = cleanProps(many)
    expect(Object.keys(out)).toHaveLength(32)
    expect((out['k0'] as string).length).toBe(256)
  })
})

class MemoryStore implements SettingsStore {
  values = new Map<string, unknown>()
  getSetting<T>(key: string, schema: z.ZodType<T>): T | null {
    const parsed = schema.safeParse(this.values.get(key))
    return this.values.has(key) && parsed.success ? parsed.data : null
  }
  setSetting(key: string, value: unknown): void {
    this.values.set(key, JSON.parse(JSON.stringify(value)))
  }
}

const device: DeviceInfo = {
  os: { platform: 'darwin', release: '25.3.0', version: 'Darwin', arch: 'arm64' },
  cpu: { model: 'M4', cores: 10 },
  memoryBytes: 1,
  gpus: [],
  displays: [],
  locale: 'en-US',
  app: { version: '0.1.0', electron: '44', chrome: '150', node: '24', packaged: false },
}
const deviceId = 'a'.repeat(64)
const sessionId = '00000000-0000-4000-8000-000000000000'

type Call = { path: string; auth: string | null; body: Record<string, unknown> }

function setup(respond: (call: Call, n: number) => Response | Promise<Response>, overrides: Partial<ClientDeps> = {}) {
  const store = new MemoryStore()
  const calls: Call[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const call = { path: new URL(String(input)).pathname, auth: headers.get('authorization'), body: JSON.parse(String(init?.body)) }
    calls.push(call)
    return respond(call, calls.length)
  }) as typeof globalThis.fetch
  const make = () =>
    new TelemetryClient({
      baseUrl: 'http://telemetry.test',
      appVersion: '0.1.0',
      store,
      identify: async () => ({ deviceId, device }),
      fetch,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      sessionId,
      ...overrides,
    })
  return { store, calls, make }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ok = (call: Call) => (call.path.endsWith('/register') ? json({ token: 'tok-1' }) : json({ events: 0, errors: 0 }))

describe('TelemetryClient', () => {
  it('coalesces counters into one event per name per flush', async () => {
    const { calls, make } = setup(ok)
    const client = make()
    client.count('ipc:threads:prompt')
    client.count('ipc:threads:prompt')
    client.count('ipc:app:snapshot')
    await client.flush()
    const ingest = calls.find((c) => c.path === '/api/telemetry/ingest')!
    expect(ingest.auth).toBe('Bearer tok-1')
    expect(ingest.body['events']).toEqual([
      { name: 'ipc:threads:prompt', props: { count: 2 }, at: '2026-01-01T00:00:00.000Z' },
      { name: 'ipc:app:snapshot', props: { count: 1 }, at: '2026-01-01T00:00:00.000Z' },
    ])
    expect(client.queued()).toEqual({ events: [], errors: [], counts: {} })
  })

  it('drops the oldest items beyond the batch limits', () => {
    const client = setup(ok).make()
    for (let i = 0; i < 510; i++) client.track(`e${i}`)
    for (let i = 0; i < 105; i++) client.error({ source: 'main', name: 'Error', message: `m${i}` })
    const { events, errors } = client.queued()
    expect(events).toHaveLength(500)
    expect(events[0]!.name).toBe('e10')
    expect(errors).toHaveLength(100)
    expect(errors[0]!.message).toBe('m5')
  })

  it('scrubs and truncates errors', () => {
    const client = setup(ok, { scrub: (t) => t.replaceAll('/Users/alice', '~') }).make()
    client.error({ source: 'ipc', name: 'Error', message: `/Users/alice ${'x'.repeat(3000)}`, stack: 's', context: { channel: 'threads:prompt' } })
    const [error] = client.queued().errors
    expect(error!.message.startsWith('~ x')).toBe(true)
    expect(error!.message).toHaveLength(2000)
    expect(error!.context).toEqual({ channel: 'threads:prompt' })
  })

  it('sends the device only when it changed since the server last took it', async () => {
    const { calls, make, store } = setup(ok)
    const client = make()
    client.track('app.start')
    await client.flush()
    expect(calls.map((c) => c.path)).toEqual(['/api/telemetry/register', '/api/telemetry/ingest'])
    expect(calls[1]!.body['device']).toBeUndefined()
    store.setSetting(SETTINGS.deviceHash, 'stale')
    client.track('again')
    await client.flush()
    expect(calls[2]!.body['device']).toEqual(device)
  })

  it('re-registers once on 401 and retries with the new token', async () => {
    const { calls, make, store } = setup((call, n) => {
      if (call.path.endsWith('/register')) return json({ token: 'tok-2' })
      return n === 1 ? json({ error: 'unauthorized' }, 401) : json({ events: 1, errors: 0 })
    })
    store.setSetting(SETTINGS.token, 'old')
    const client = make()
    client.track('app.start')
    await client.flush()
    expect(calls.map((c) => [c.path, c.auth])).toEqual([
      ['/api/telemetry/ingest', 'Bearer old'],
      ['/api/telemetry/register', null],
      ['/api/telemetry/ingest', 'Bearer tok-2'],
    ])
    expect(store.getSetting(SETTINGS.token, z.string())).toBe('tok-2')
  })

  it('keeps items queued when the network fails, and never throws', async () => {
    const { make, store } = setup(() => Promise.reject(new TypeError('fetch failed')))
    store.setSetting(SETTINGS.token, 'tok')
    const client = make()
    client.track('app.start')
    await expect(client.flush()).resolves.toBeUndefined()
    expect(client.queued().events.map((e) => e.name)).toEqual(['app.start'])
  })

  it('persists unsent items and sends them next run under the old session', async () => {
    const { calls, make, store } = setup(() => Promise.reject(new Error('offline')))
    const first = make()
    first.track('app.quit')
    first.count('ipc:app:snapshot')
    first.persist()
    store.setSetting(SETTINGS.token, 'tok')
    const next = new TelemetryClient({
      baseUrl: 'http://telemetry.test',
      appVersion: '0.1.0',
      store,
      identify: async () => ({ deviceId, device }),
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        calls.push({ path: 'ingest', auth: null, body: JSON.parse(String(init?.body)) })
        return json({ events: 2, errors: 0 })
      }) as typeof fetch,
      sessionId: '11111111-1111-4111-8111-111111111111',
    })
    expect(store.getSetting(SETTINGS.pending, z.unknown())).toBeNull()
    await next.flush()
    const sent = calls.at(-1)!.body
    expect(sent['sessionId']).toBe(sessionId)
    expect((sent['events'] as { name: string }[]).map((e) => e.name)).toEqual(['app.quit', 'ipc:app:snapshot'])
  })

  it('stops recording and clears the queue when disabled', async () => {
    const { calls, make, store } = setup(ok)
    const client = make()
    client.track('app.start')
    client.count('ipc:x')
    client.setEnabled(false)
    client.track('ignored')
    await client.flush()
    expect(calls).toEqual([])
    expect(client.queued()).toEqual({ events: [], errors: [], counts: {} })
    expect(make().isEnabled).toBe(false)
    expect(store.values.get(SETTINGS.enabled)).toBe(false)
  })
})
