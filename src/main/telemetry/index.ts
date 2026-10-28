import { randomUUID } from 'node:crypto'
import { homedir, userInfo } from 'node:os'
import { app, type Details, type RenderProcessGoneDetails } from 'electron'
import { z } from 'zod'
import type { TelemetryState } from '@shared/api'
import { SETTINGS, TelemetryClient, type ErrorInput, type SettingsStore } from './client'
import { collectDeviceInfo } from './device-info'
import { hashDeviceId, readHardwareId } from './device-id'
import { scrub, type ScrubContext } from './scrub'

const FLUSH_MS = 30_000
const QUIT_FLUSH_MS = 1500

export type Telemetry = {
  state(): TelemetryState
  setEnabled(enabled: boolean): void
  /** One coalesced usage count per IPC channel per flush. Never sees the arguments. */
  invoked(channel: string): void
  failed(channel: string, err: unknown): void
  rendererError(raw: unknown): void
}

const rendererError = z.object({ name: z.string(), message: z.string(), stack: z.string().optional() })

function baseUrl(): string | null {
  if (process.env['ONIKO_TELEMETRY'] === '0' || process.env['ONIKO_SMOKE_CWD']) return null
  return process.env['ONIKO_TELEMETRY_URL'] ?? import.meta.env.MAIN_VITE_TELEMETRY_URL ?? (app.isPackaged ? null : 'http://localhost:3000')
}

function errorFields(err: unknown): Pick<ErrorInput, 'name' | 'message' | 'stack'> {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  return { name: typeof err, message: String(err) }
}

async function deviceId(store: SettingsStore): Promise<string> {
  const hardware = await readHardwareId()
  if (hardware) return hashDeviceId(hardware)
  const stored = store.getSetting(SETTINGS.fallbackId, z.string())
  if (stored) return hashDeviceId(stored)
  const fresh = randomUUID()
  store.setSetting(SETTINGS.fallbackId, fresh)
  return hashDeviceId(fresh)
}

/** Call once the app is ready, with the settings store still open until will-quit. */
export function startTelemetry(store: SettingsStore): Telemetry {
  const url = baseUrl()
  if (!url) {
    return {
      state: () => ({ enabled: false, available: false }),
      setEnabled: (enabled) => store.setSetting(SETTINGS.enabled, enabled),
      invoked: () => {},
      failed: () => {},
      rendererError: () => {},
    }
  }
  let user = ''
  try {
    user = userInfo().username
  } catch {}
  const ctx: ScrubContext = { home: homedir(), user, appPath: app.getAppPath() }
  const client = new TelemetryClient({
    baseUrl: url,
    appVersion: app.getVersion(),
    store,
    identify: async () => ({ deviceId: await deviceId(store), device: await collectDeviceInfo() }),
    scrub: (text) => scrub(text, ctx),
  })
  const startedAt = Date.now()
  client.track('app.start', { coldStartMs: Math.round(process.uptime() * 1000) })
  void client.start()
  setInterval(() => void client.flush(), FLUSH_MS).unref()

  // A listener keeps Node from crashing and Electron from showing its dialog, so log what it would have shown.
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception in main:', err)
    client.error({ source: 'main', ...errorFields(err) })
  })
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection in main:', reason)
    client.error({ source: 'main', ...errorFields(reason) })
  })
  const gone = (name: string, details: Details | RenderProcessGoneDetails) => {
    if (details.reason === 'clean-exit') return
    const type = 'type' in details ? details.type : 'renderer'
    client.error({
      source: 'process',
      name,
      message: `${type} process gone: ${details.reason} (exit ${details.exitCode})`,
      context: { type, reason: details.reason, exitCode: details.exitCode },
    })
  }
  app.on('render-process-gone', (_event, _contents, details) => gone('RenderProcessGone', details))
  app.on('child-process-gone', (_event, details) => gone('ChildProcessGone', details))

  // Holds the quit once for a short, best-effort flush, then lets it proceed.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting || !client.isEnabled) return
    quitting = true
    event.preventDefault()
    client.track('app.quit', { sessionSeconds: Math.round((Date.now() - startedAt) / 1000) })
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_MS))
    void Promise.race([client.flush(), timeout]).then(() => {
      client.persist()
      app.quit()
    })
  })

  return {
    state: () => ({ enabled: client.isEnabled, available: true }),
    setEnabled: (enabled) => client.setEnabled(enabled),
    invoked: (channel) => client.count(`ipc:${channel}`),
    failed: (channel, err) => client.error({ source: 'ipc', ...errorFields(err), context: { channel } }),
    rendererError: (raw) => {
      const parsed = rendererError.safeParse(raw)
      if (parsed.success) client.error({ source: 'renderer', ...parsed.data })
    },
  }
}
