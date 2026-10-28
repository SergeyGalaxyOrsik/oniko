import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Settings } from 'lucide-react'
import { AppSidebar } from '@/components/app-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AGENTS } from '@shared/agents'
import { newThreadConfig, withValue } from '@shared/config'
import { activeSubscription, type Subscription, type SubscriptionsState } from '@shared/subscriptions'
import { AgentGlyph } from './agent-glyph'
import { isBusy, type Thread, type ThreadId } from '@shared/thread'
import { AuthCard } from './auth-card'
import { Composer } from './composer'
import { FolderPicker } from './folder-picker'
import { basename } from './format'
import { SettingsView } from './settings-view'
import { LoginHint } from './subscription-ui'
import { LOCKED_HINT, SubscriptionPicker } from './subscription-picker'
import { Timeline } from './timeline'
import { useAppState } from './use-app-state'

function StatusBanner({ thread, subscription }: { thread: Thread; subscription: Subscription | undefined }) {
  if (subscription?.account.kind === 'logged_out') return <LoginHint subscription={subscription} />
  const s = thread.status
  if (s.kind === 'auth_required') return <AuthCard thread={thread} methods={s.methods} />
  if (s.kind === 'error') return <p className="text-sm text-destructive">{AGENTS[thread.agentId].label} failed to start: {s.message}</p>
  if (s.kind === 'exited')
    return <p className="text-sm text-muted-foreground">{AGENTS[thread.agentId].label} stopped (exit code {s.code ?? 'none'}). Send a message to reconnect.</p>
  return null
}

function ThreadView({ thread, subscriptions }: { thread: Thread; subscriptions: SubscriptionsState }) {
  const busy = isBusy(thread.status)
  const subscription = subscriptions.subscriptions.find((s) => s.id === thread.subscriptionId)
  return (
    <>
      <Timeline thread={thread} />
      <div className="mx-auto w-full max-w-3xl space-y-3 px-6 pb-5">
        <StatusBanner thread={thread} subscription={subscription} />
        <Composer
          leading={<SubscriptionPicker subscriptions={subscriptions.subscriptions} current={subscription} readOnly />}
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

/** Where the inset card points. Settings remembers what it covered so Esc and Back return there. */
type ChatView = { kind: 'new' } | { kind: 'thread'; id: ThreadId }
type View = ChatView | { kind: 'settings'; back: ChatView }

function NoSubscription({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div data-testid="no-subscription" className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/40 p-4 text-sm">
      <span>Add a subscription in Settings to start a thread.</span>
      <Button size="sm" variant="outline" onClick={onOpenSettings}>
        <Settings />
        Open Settings
      </Button>
    </div>
  )
}

function NewThread({
  subscriptions,
  threads,
  onCreated,
  onOpenSettings,
}: {
  subscriptions: SubscriptionsState
  threads: Thread[]
  onCreated: (id: ThreadId) => void
  onOpenSettings: () => void
}) {
  const [recent, setRecent] = useState<string[]>([])
  const [cwd, setCwd] = useState<string | null>(null)
  const active = activeSubscription(subscriptions)

  useEffect(() => {
    void window.oniko.folders.recent().then((list) => {
      setRecent(list)
      setCwd((current) => current ?? list[0] ?? null)
    })
  }, [])

  // Picks made before the session exists; the template's own values fill whatever was not touched.
  const [picked, setPicked] = useState<Record<string, string>>({})
  const template = useMemo(() => (active ? newThreadConfig(threads, active.agentId, active.id) : []), [threads, active])
  const config = template.reduce((acc, c) => {
    const value = picked[c.id]
    return value && c.options.some((o) => o.value === value) ? withValue(acc, c.id, value) : acc
  }, template)

  const send = async (text: string) => {
    if (!cwd || !active) return
    const values = Object.fromEntries(config.map((c) => [c.id, c.value]))
    const id = await window.oniko.threads.create({ cwd, subscriptionId: active.id, config: values })
    onCreated(id)
    await window.oniko.threads.prompt(id, text)
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
      <h1 className="text-center text-3xl font-medium tracking-tight">
        What should we build in <FolderPicker cwd={cwd} recent={recent} onPick={setCwd} />?
      </h1>
      <p className="mt-2 max-w-3xl truncate text-sm text-muted-foreground">{cwd ? cwd : 'Pick a project folder to start'}</p>
      <div className="mt-8 w-full max-w-3xl space-y-3">
        {active ? null : <NoSubscription onOpenSettings={onOpenSettings} />}
        <Composer
          busy={false}
          disabled={!cwd || !active}
          leading={<SubscriptionPicker subscriptions={subscriptions.subscriptions} current={active} readOnly={false} />}
          config={config}
          onSend={(text) => void send(text)}
          onStop={() => {}}
          onConfig={(configId, value) => setPicked((p) => ({ ...p, [configId]: value }))}
        />
      </div>
    </div>
  )
}

function ThreadSubscriptionBadge({ subscription }: { subscription: Subscription | undefined }) {
  if (!subscription) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" data-testid="thread-subscription" className="no-drag ml-auto gap-1.5 font-normal text-muted-foreground">
          <AgentGlyph agentId={subscription.agentId} className="size-3" />
          {subscription.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{LOCKED_HINT}</TooltipContent>
    </Tooltip>
  )
}

function InsetHeader({
  view,
  thread,
  subscriptions,
  onBack,
}: {
  view: View
  thread: Thread | undefined
  subscriptions: SubscriptionsState
  onBack: () => void
}) {
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
          {view.kind === 'settings' ? (
            <>
              <BreadcrumbItem>Settings</BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Subscriptions</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : thread ? (
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
      {view.kind === 'settings' ? (
        <Button variant="ghost" size="sm" className="no-drag ml-auto" onClick={onBack} data-testid="settings-back">
          <ArrowLeft />
          Back
        </Button>
      ) : thread ? (
        <ThreadSubscriptionBadge subscription={subscriptions.subscriptions.find((s) => s.id === thread.subscriptionId)} />
      ) : null}
    </header>
  )
}

export function App() {
  const { threads, subscriptions, home } = useAppState()
  const [view, setView] = useState<View>({ kind: 'new' })
  const list = Object.values(threads).sort((a, b) => b.createdAt - a.createdAt)
  const chat = view.kind === 'settings' ? view.back : view
  const selected = chat.kind === 'thread' ? threads[chat.id] : undefined
  const startNew = useCallback(() => setView({ kind: 'new' }), [])
  const selectThread = useCallback((id: ThreadId) => setView({ kind: 'thread', id }), [])
  const openSettings = useCallback(() => setView((v) => (v.kind === 'settings' ? v : { kind: 'settings', back: v })), [])
  const closeSettings = useCallback(() => setView((v) => (v.kind === 'settings' ? v.back : v)), [])

  useEffect(() => {
    if (view.kind !== 'settings') return
    const onKey = (e: KeyboardEvent) => {
      // Esc inside an open dialog or menu closes that layer, not the page under it.
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return
      closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view.kind, closeSettings])

  return (
    <SidebarProvider className="h-full min-h-0">
      <AppSidebar
        threads={list}
        selectedId={view.kind === 'thread' ? view.id : null}
        onSelectThread={selectThread}
        onNew={startNew}
        settingsOpen={view.kind === 'settings'}
        onOpenSettings={openSettings}
        subscriptions={subscriptions}
      />
      <SidebarInset className="min-h-0 overflow-hidden">
        <InsetHeader view={view} thread={selected} subscriptions={subscriptions} onBack={closeSettings} />
        {view.kind === 'settings' ? (
          <SettingsView state={subscriptions} threads={list} home={home} />
        ) : selected ? (
          <ThreadView key={selected.id} thread={selected} subscriptions={subscriptions} />
        ) : (
          <NewThread subscriptions={subscriptions} threads={list} onCreated={selectThread} onOpenSettings={openSettings} />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
