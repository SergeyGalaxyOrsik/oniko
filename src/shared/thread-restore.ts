import type { Thread } from './thread'

export const INTERRUPTED_NOTICE = 'Interrupted when Oniko closed'

/** A thread read back from disk has no live agent process, so it becomes dormant until the next prompt. */
export function restoreThread(thread: Thread): Thread {
  const kind = thread.status.kind
  const interrupted = kind === 'running' || kind === 'connecting' || kind === 'awaiting_permission'
  const timeline = thread.timeline.map((item) =>
    item.kind === 'permission' && item.outcome === null ? { ...item, outcome: 'cancelled' as const } : item,
  )
  if (interrupted) {
    timeline.push({ kind: 'notice', id: `notice-${timeline.length}`, level: 'info', text: INTERRUPTED_NOTICE })
  }
  return { ...thread, status: { kind: 'dormant' }, timeline }
}
