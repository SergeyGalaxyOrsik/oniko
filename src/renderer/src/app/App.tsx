import { useCallback, useEffect, useState } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { AGENT_IDS, AGENTS, type AgentId } from '@shared/agents'
import { isBusy, type Thread, type ThreadId } from '@shared/thread'
import { AuthCard } from './auth-card'
import { Composer } from './composer'
import { FolderPicker } from './folder-picker'
import { basename } from './format'
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
      <p className="mt-2 max-w-3xl truncate text-sm text-muted-foreground">{cwd ? cwd : 'Pick a project folder to start'}</p>
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

function InsetHeader({ thread }: { thread: Thread | undefined }) {
  const { state } = useSidebar()
  return (
    <header
      className={cn(
        'drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 text-sm transition-[padding]',
        state === 'collapsed' && 'pl-20',
      )}
    >
      <SidebarTrigger className="no-drag -ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {thread ? (
            <>
              <BreadcrumbItem>{basename(thread.cwd)}</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage data-testid="thread-title" className="truncate">
                  {thread.title || 'New thread'}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem>
              <BreadcrumbPage>New thread</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      {thread ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{AGENTS[thread.agentId].label}</span> : null}
    </header>
  )
}

export function App() {
  const { threads } = useThreads()
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null)
  const list = Object.values(threads).sort((a, b) => b.createdAt - a.createdAt)
  const selected = selectedId ? threads[selectedId] : undefined
  const startNew = useCallback(() => setSelectedId(null), [])

  return (
    <SidebarProvider className="h-full min-h-0">
      <AppSidebar threads={list} selectedId={selectedId} onSelectThread={setSelectedId} onNew={startNew} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <InsetHeader thread={selected} />
        {selected ? <ThreadView key={selected.id} thread={selected} /> : <NewThread onCreated={setSelectedId} />}
      </SidebarInset>
    </SidebarProvider>
  )
}
