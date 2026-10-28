import { useCallback, useEffect, useState } from 'react'
import { PanelLeft } from 'lucide-react'
import { AGENT_IDS, AGENTS, type AgentId } from '@shared/agents'
import { isBusy, type Thread, type ThreadId } from '@shared/thread'
import { AuthCard } from './auth-card'
import { Composer } from './composer'
import { FolderPicker } from './folder-picker'
import { basename } from './format'
import { Sidebar } from './sidebar'
import { Timeline } from './timeline'
import { useThreads } from './use-threads'

function StatusBanner({ thread }: { thread: Thread }) {
  const s = thread.status
  if (s.kind === 'auth_required') return <AuthCard thread={thread} methods={s.methods} />
  if (s.kind === 'error') return <p className="text-sm text-destructive">{AGENTS[thread.agentId].label} failed to start: {s.message}</p>
  if (s.kind === 'exited')
    return <p className="text-sm text-muted-foreground">{AGENTS[thread.agentId].label} stopped (exit code {s.code ?? 'none'}). Send a message to reconnect.</p>
  return null
}

function ThreadView({ thread }: { thread: Thread }) {
  const busy = isBusy(thread.status)
  return (
    <>
      <Timeline thread={thread} />
      <div className="mx-auto w-full max-w-3xl space-y-3 px-6 pb-5">
        <StatusBanner thread={thread} />
        <Composer
          busy={busy}
          config={thread.config}
          onSend={(text) => void window.oniko.threads.prompt(thread.id, text)}
          onStop={() => void window.oniko.threads.cancel(thread.id)}
          onConfig={(configId, value) => void window.oniko.threads.setConfig(thread.id, configId, value)}
        />
      </div>
    </>
  )
}

function NewThread({ onCreated }: { onCreated: (id: ThreadId) => void }) {
  const [recent, setRecent] = useState<string[]>([])
  const [cwd, setCwd] = useState<string | null>(null)
  const [agentId, setAgentId] = useState<AgentId>(AGENT_IDS[0]!)

  useEffect(() => {
    void window.oniko.folders.recent().then((list) => {
      setRecent(list)
      setCwd((current) => current ?? list[0] ?? null)
    })
  }, [])

  const send = async (text: string) => {
    if (!cwd) return
    const id = await window.oniko.threads.create({ agentId, cwd })
    onCreated(id)
    await window.oniko.threads.prompt(id, text)
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
      <h1 className="text-center text-3xl font-medium tracking-tight">
        What should we build in <FolderPicker cwd={cwd} recent={recent} onPick={setCwd} />?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{cwd ? cwd : 'Pick a project folder to start'}</p>
      <div className="mt-8 w-full max-w-3xl">
        <Composer
          busy={false}
          disabled={!cwd}
          config={[]}
          onSend={(text) => void send(text)}
          onStop={() => {}}
          onConfig={() => {}}
          agent={{ value: agentId, onChange: setAgentId }}
        />
      </div>
    </div>
  )
}

export function App() {
  const { threads } = useThreads()
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const list = Object.values(threads).sort((a, b) => b.createdAt - a.createdAt)
  const selected = selectedId ? threads[selectedId] : undefined
  const startNew = useCallback(() => setSelectedId(null), [])

  return (
    <div className="flex h-full">
      {collapsed ? null : (
        <Sidebar threads={list} selectedId={selectedId} onSelect={setSelectedId} onNew={startNew} onCollapse={() => setCollapsed(true)} />
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 text-sm">
          {collapsed ? (
            <button type="button" onClick={() => setCollapsed(false)} aria-label="Expand sidebar" className="no-drag ml-16 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <PanelLeft className="size-4" />
            </button>
          ) : null}
          {selected ? (
            <>
              <span className="text-muted-foreground">{basename(selected.cwd)}</span>
              <span className="text-muted-foreground/50">/</span>
              <span data-testid="thread-title" className="truncate">{selected.title || 'New thread'}</span>
              <span className="ml-auto text-xs text-muted-foreground">{AGENTS[selected.agentId].label}</span>
            </>
          ) : (
            <span>New thread</span>
          )}
        </header>
        {selected ? <ThreadView key={selected.id} thread={selected} /> : <NewThread onCreated={setSelectedId} />}
      </main>
    </div>
  )
}
