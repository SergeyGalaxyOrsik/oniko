import { useEffect, useState, type ReactNode } from 'react'
import { Check, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { planLabel, type AccountStatus, type Subscription, type SubscriptionId, type SubscriptionsState } from '@shared/subscriptions'
import type { Thread } from '@shared/thread'
import { AddSubscriptionDialog } from './add-subscription-dialog'
import { AgentGlyph } from './agent-glyph'
import { relativeTime } from './format'
import { CopyButton, LoginCommand, StatusDot, shortenHome } from './subscription-ui'
import { useNow } from './use-now'

// Layout primitives after T3 Code's settings: a titled section over a grouped panel of rows.

function SettingsSection({ title, icon, headerAction, children }: { title: string; icon?: ReactNode; headerAction?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex min-h-7 items-start justify-between gap-4 px-3 sm:px-4">
        <h2 className="flex min-h-7 min-w-0 items-center gap-2 text-sm font-normal text-foreground/70">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex min-h-7 min-w-7 shrink-0 items-center justify-end gap-1.5">{headerAction}</div>
      </div>
      {children}
    </section>
  )
}

function SettingsPanel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('relative rounded-xl border border-border/60 bg-card/40 text-foreground shadow-xs/5 [&>*+*]:border-t [&>*+*]:border-border/50', className)}>
      {children}
    </div>
  )
}

function SettingsRow({
  title,
  description,
  status,
  control,
  children,
}: {
  title: string
  description?: ReactNode
  status?: ReactNode
  control?: ReactNode
  children?: ReactNode
}) {
  return (
    <div data-slot="settings-row" className={cn('@container/settings-row px-3 sm:px-4', children ? 'space-y-3 py-3' : 'py-3')}>
      <div className="flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="flex min-h-5 items-center text-sm font-medium text-foreground">{title}</h3>
          {description ? <p className="max-w-xl text-xs leading-normal text-muted-foreground/80">{description}</p> : null}
          {status ? <div className="pt-0.5 text-xs text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full min-w-0 shrink-0 items-center gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/** Blurred until clicked, so a screenshot or a screen share does not leak the account email. */
function RedactedText({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Toggle account email visibility"
          aria-pressed={revealed}
          onClick={() => setRevealed((r) => !r)}
          className={cn(
            'min-w-0 max-w-full cursor-pointer truncate rounded-sm font-mono text-[11px] leading-normal transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            revealed ? 'text-foreground' : 'text-muted-foreground blur-xs select-none',
          )}
        >
          {value}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{revealed ? 'Click to hide email' : 'Click to reveal email'}</TooltipContent>
    </Tooltip>
  )
}

/** One status line for both the list and the editor; `withEmail` adds the redacted address. */
function AccountSummary({ account, withEmail }: { account: AccountStatus; withEmail: boolean }) {
  if (account.kind === 'logged_in') {
    const org = account.orgName && account.orgName !== `${account.email}'s Organization` ? account.orgName : null
    const extras = [planLabel(account.plan), org].filter(Boolean)
    return (
      <>
        <span>{withEmail && account.email ? 'Authenticated as' : 'Authenticated'}</span>
        {withEmail && account.email ? <RedactedText value={account.email} /> : null}
        {extras.map((part) => (
          <span key={part}>· {part}</span>
        ))}
      </>
    )
  }
  const headline: Record<Exclude<AccountStatus['kind'], 'logged_in'>, string> = {
    unknown: 'Not checked yet',
    checking: 'Checking login…',
    logged_out: 'Logged out. Sign in to use it.',
    error: account.kind === 'error' ? account.message : '',
  }
  return (
    <>
      {account.kind === 'logged_out' || account.kind === 'error' ? (
        <span className="flex h-[1.45em] shrink-0 items-center">
          <StatusDot account={account} />
        </span>
      ) : null}
      <span className="min-w-0 [overflow-wrap:anywhere]">{headline[account.kind]}</span>
    </>
  )
}

function SubscriptionListItem({
  subscription,
  active,
  selected,
  home,
  onSelect,
}: {
  subscription: Subscription
  active: boolean
  selected: boolean
  home: string
  onSelect: () => void
}) {
  return (
    <div
      data-subscription-id={subscription.id}
      data-config-dir={subscription.configDir}
      className={cn('group relative flex min-h-18 items-center gap-3 px-3 py-3 transition-colors sm:px-4', selected ? 'bg-muted/45' : 'hover:bg-muted/25')}
    >
      <button
        type="button"
        aria-label={`Select ${subscription.label}`}
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-5 shrink-0 items-center">
          <AgentGlyph agentId={subscription.agentId} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground" data-testid="subscription-label">
              {subscription.label}
            </span>
            <code className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">{shortenHome(subscription.configDir, home)}</code>
          </span>
          <span
            data-account-kind={subscription.account.kind}
            className="mt-0.5 flex items-start gap-1.5 text-xs leading-normal text-muted-foreground/80"
          >
            <AccountSummary account={subscription.account} withEmail={false} />
          </span>
        </span>
      </div>
      {active ? (
        <Badge variant="secondary" data-testid="active-badge" className="pointer-events-none relative shrink-0 font-normal">
          Active
        </Badge>
      ) : null}
    </div>
  )
}

/** Holds a local draft and commits on Enter or blur; Esc puts the stored value back. */
function DraftInput({ id, value, placeholder, onCommit }: { id: string; value: string; placeholder: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft.trim() && draft.trim() !== value) onCommit(draft)
    else setDraft(value)
  }
  return (
    <Input
      id={id}
      aria-label="Subscription name"
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      className="h-8 min-w-0 flex-1 text-sm @min-[32rem]/settings-row:w-56"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.stopPropagation()
          setDraft(value)
        }
      }}
    />
  )
}

const ghostMuted = 'text-muted-foreground hover:text-foreground'

function SubscriptionEditor({ subscription, active, usedBy, home }: { subscription: Subscription; active: boolean; usedBy: number; home: string }) {
  const checking = subscription.account.kind === 'checking'
  const removeReason = usedBy > 0 ? `Used by ${usedBy} thread${usedBy === 1 ? '' : 's'}. Remove those threads first, or keep it.` : null
  const dir = shortenHome(subscription.configDir, home)

  const headerAction = (
    <>
      <code className="max-w-48 truncate text-xs text-muted-foreground">{dir}</code>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ghostMuted}
            aria-label="Refresh login status"
            disabled={checking}
            onClick={() => void window.oniko.subscriptions.refresh(subscription.id)}
          >
            <RefreshCw className={cn(checking && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Refresh login status</TooltipContent>
      </Tooltip>
      <Tooltip>
        {/* A disabled button gets no pointer events, so the tooltip hangs off a wrapper. */}
        <TooltipTrigger asChild>
          <span tabIndex={removeReason ? 0 : -1} className="inline-flex">
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${subscription.label}`}
              data-testid="remove-subscription"
              disabled={removeReason !== null}
              onClick={() => void window.oniko.subscriptions.remove(subscription.id)}
            >
              <Trash2 />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72">
          {removeReason ?? 'Remove subscription'}
        </TooltipContent>
      </Tooltip>
    </>
  )

  return (
    <div className="space-y-6 p-4" data-testid="subscription-editor" data-editor-subscription-id={subscription.id}>
      <SettingsSection title={subscription.label} icon={<AgentGlyph agentId={subscription.agentId} className="size-4" />} headerAction={headerAction}>
        <SettingsPanel>
          <SettingsRow
            title="Display name"
            status={
              <div data-testid="subscription-account" className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                <AccountSummary account={subscription.account} withEmail />
              </div>
            }
            control={
              <DraftInput
                id={`subscription-${subscription.id}-label`}
                value={subscription.label}
                placeholder="Subscription name"
                onCommit={(label) => void window.oniko.subscriptions.update(subscription.id, { label })}
              />
            }
          />
          <SettingsRow
            title="New threads"
            description="New threads start on the active subscription. A thread stays on the one it started with."
            control={
              active ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Check className="size-3.5" />
                  Active
                </span>
              ) : (
                <Button variant="outline" size="xs" data-testid="make-active" onClick={() => void window.oniko.subscriptions.setActive(subscription.id)}>
                  Make active
                </Button>
              )
            }
          />
          <SettingsRow
            title="Config folder"
            description="Holds this subscription's login and its sessions, so threads resume only here."
            control={
              <div className="flex min-w-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 py-0.5 pr-0.5 pl-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{dir}</code>
                <CopyButton text={subscription.configDir} label="Copy folder path" />
              </div>
            }
          />
          <SettingsRow
            title="Threads"
            description={usedBy > 0 ? `${usedBy} thread${usedBy === 1 ? '' : 's'} run on this subscription.` : 'No threads use it yet.'}
          />
        </SettingsPanel>
      </SettingsSection>
      {subscription.account.kind === 'logged_out' ? (
        <SettingsSection title="Sign in">
          <SettingsPanel>
            <SettingsRow
              title="Log in from a terminal"
              description="The app does not run the login flow itself. Run this for the folder, then refresh."
            >
              <div data-testid="login-hint">
                <LoginCommand subscription={subscription} />
              </div>
            </SettingsRow>
          </SettingsPanel>
        </SettingsSection>
      ) : null}
    </div>
  )
}

function lastChecked(subscriptions: Subscription[]): number | null {
  const times = subscriptions.flatMap((s) => ('checkedAt' in s.account ? [s.account.checkedAt] : []))
  return times.length ? Math.max(...times) : null
}

function RefreshAll({ subscriptions }: { subscriptions: Subscription[] }) {
  const now = useNow(30_000)
  const refreshing = subscriptions.some((s) => s.account.kind === 'checking')
  const at = lastChecked(subscriptions)
  const since = at === null ? null : relativeTime(at, now)
  const label = refreshing ? 'Checking logins' : since === null ? 'Check logins' : since === 'now' ? 'Checked just now' : `Checked ${since} ago`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={ghostMuted}
          disabled={refreshing || subscriptions.length === 0}
          aria-busy={refreshing}
          onClick={() => subscriptions.forEach((s) => void window.oniko.subscriptions.refresh(s.id))}
        >
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
          <span className="sr-only">Refresh login status</span>
          <span className="hidden min-w-0 truncate sm:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Refresh login status</TooltipContent>
    </Tooltip>
  )
}

export function SettingsView({ state, threads, home }: { state: SubscriptionsState; threads: Thread[]; home: string }) {
  const { subscriptions, activeSubscriptionId } = state
  const [selectedId, setSelectedId] = useState<SubscriptionId | null>(activeSubscriptionId)
  // A removed or not yet chosen selection falls back to the active row, then the first.
  const selected =
    subscriptions.find((s) => s.id === selectedId) ?? subscriptions.find((s) => s.id === activeSubscriptionId) ?? subscriptions[0] ?? null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="settings-view">
      <div className="@container/subscriptions mx-auto w-full max-w-5xl px-6 py-8">
        <SettingsSection
          title="Subscriptions"
          headerAction={
            <>
              <RefreshAll subscriptions={subscriptions} />
              <AddSubscriptionDialog home={home} added={subscriptions} compact />
            </>
          }
        >
          {subscriptions.length === 0 ? (
            <SettingsPanel className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">No subscriptions yet. Add a Claude config folder to start a thread.</p>
              <AddSubscriptionDialog home={home} added={subscriptions} />
            </SettingsPanel>
          ) : (
            <SettingsPanel className="overflow-hidden @min-[48rem]/subscriptions:grid @min-[48rem]/subscriptions:grid-cols-[17rem_minmax(0,1fr)] [&>*+*]:border-t-0">
              <div className="border-b border-border/60 bg-muted/10 @min-[48rem]/subscriptions:border-r @min-[48rem]/subscriptions:border-b-0">
                <div className="divide-y divide-border/50">
                  {subscriptions.map((sub) => (
                    <SubscriptionListItem
                      key={sub.id}
                      subscription={sub}
                      active={sub.id === activeSubscriptionId}
                      selected={sub.id === selected?.id}
                      home={home}
                      onSelect={() => setSelectedId(sub.id)}
                    />
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                {selected ? (
                  <SubscriptionEditor
                    key={selected.id}
                    subscription={selected}
                    active={selected.id === activeSubscriptionId}
                    usedBy={threads.filter((t) => t.subscriptionId === selected.id).length}
                    home={home}
                  />
                ) : null}
              </div>
            </SettingsPanel>
          )}
        </SettingsSection>
      </div>
    </div>
  )
}
