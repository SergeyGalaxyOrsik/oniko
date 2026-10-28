import type { RendererErrorReport } from '@shared/api'

// Registered here, in the page's own world: error events from page scripts do not reach the
// isolated preload world, so the preload only carries the report to main.

function report(err: unknown, fallback: string): void {
  const value: RendererErrorReport =
    err instanceof Error
      ? { name: err.name, message: err.message, ...(err.stack ? { stack: err.stack } : {}) }
      : { name: 'Error', message: err === undefined || err === null ? fallback : String(err) }
  try {
    window.oniko.telemetry.reportError(value)
  } catch {}
}

window.addEventListener('error', (e) => report(e.error ?? e.message, e.message))
window.addEventListener('unhandledrejection', (e) => report(e.reason, 'Unhandled rejection'))
