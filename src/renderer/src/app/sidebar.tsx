import { useEffect, useState } from 'react'
import { PanelLeft, SquarePen, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Thread, ThreadId, ThreadStatus } from '@shared/thread'
import { AgentGlyph } from './agent-glyph'
import { basename, relativeTime } from './format'

const DOT: Partial<Record<ThreadStatus['kind'], string>> = {
  connecting: 'bg-sky-400 animate-pulse',
  running: 'bg-sky-400 animate-pulse',
  awaiting_permission: 'bg-amber-400',
  auth_required: 'bg-amber-400',
  error: 'bg-red-500',
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function Sidebar({
  threads,
  selectedId,
  onSelect,
  onNew,
  onCollapse,
}: {
  threads: Thread[]
  selectedId: ThreadId | null
  onSelect: (id: ThreadId) => void
  onNew: () => void
  onCollapse: () => void
}) {
  const now = useNow(30_000)
  const groups = new Map<string, Thread[]>()
  for (const thread of threads) groups.set(thread.cwd, [...(groups.get(thread.cwd) ?? []), thread])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="drag flex h-12 items-center gap-2 pl-20 pr-2">
        <button type="button" onClick={onCollapse} aria-label="Collapse sidebar" className="no-drag rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <PanelLeft className="size-4" />
        </button>
        <span className="text-sm font-semibold tracking-tight">Oniko</span>
        <button type="button" onClick={onNew} aria-label="New thread" className="no-drag ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <SquarePen className="size-4" />
        </button>
      </div>
      <nav className="scrollbar-hide flex-1 overflow-y-auto px-2 pb-4">
        {threads.length === 0 ? <p className="px-2 pt-4 text-xs text-muted-foreground">No threads yet.</p> : null}
        {[...groups].map(([cwd, list]) => (
          <section key={cwd} className="mt-4">
            <h2 className="truncate px-2 pb-1 text-xs font-medium text-muted-foreground" title={cwd}>
              {basename(cwd)}
            </h2>
            {list.map((thread) => (
              <div
                key={thread.id}
                data-thread-id={thread.id}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                  thread.id === selectedId ? 'bg-muted text-foreground' : 'text-foreground/75 hover:bg-muted/50',
                )}
              >
                <button type="button" onClick={() => onSelect(thread.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <AgentGlyph agentId={thread.agentId} />
                  <span className="min-w-0 flex-1 truncate">{thread.title || 'New thread'}</span>
                  {DOT[thread.status.kind] ? (
                    <span aria-label={thread.status.kind} className={cn('size-1.5 shrink-0 rounded-full', DOT[thread.status.kind])} />
                  ) : null}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground group-hover:hidden">{relativeTime(thread.createdAt, now)}</span>
                </button>
                <button
                  type="button"
                  aria-label="Delete thread"
                  onClick={() => void window.oniko.threads.remove(thread.id)}
                  className="hidden shrink-0 text-muted-foreground hover:text-foreground group-hover:block"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </section>
        ))}
      </nav>
    </aside>
  )
}
