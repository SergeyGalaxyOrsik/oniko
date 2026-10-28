import { useState } from 'react'
import { Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { accountLine, type Subscription, type SubscriptionsState } from '@shared/subscriptions'
import type { Thread } from '@shared/thread'
import { AddSubscriptionDialog } from './add-subscription-dialog'
import { AccountBadge, LoginHint, shortenHome } from './subscription-ui'

function InlineLabel({ subscription }: { subscription: Subscription }) {
  const [draft, setDraft] = useState<string | null>(null)
  const save = () => {
    if (draft !== null && draft.trim() !== subscription.label) void window.oniko.subscriptions.update(subscription.id, { label: draft })
    setDraft(null)
  }
  if (draft !== null) {
    return (
      <Input
        autoFocus
        aria-label="Subscription name"
        value={draft}
        className="h-7 w-56 text-sm font-medium"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') {
            e.stopPropagation()
            setDraft(null)
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => setDraft(subscription.label)}
      className="group/label inline-flex min-w-0 items-center gap-1.5 rounded-md text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Rename"
    >
      <span className="truncate" data-testid="subscription-label">
        {subscription.label}
      </span>
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/label:opacity-100" />
    </button>
  )
}

function SubscriptionRow({ subscription, active, usedBy, home }: { subscription: Subscription; active: boolean; usedBy: number; home: string }) {
  const account = accountLine(subscription.account)
  const checking = subscription.account.kind === 'checking'
  const removeReason = usedBy > 0 ? `Used by ${usedBy} thread${usedBy === 1 ? '' : 's'}` : null
  return (
    <Card data-subscription-id={subscription.id} data-config-dir={subscription.configDir} className="gap-3 px-5 py-4 shadow-none">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <InlineLabel subscription={subscription} />
            {active ? (
              <Badge variant="secondary" data-testid="active-badge">
                Active
              </Badge>
            ) : null}
            <AccountBadge account={subscription.account} />
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{shortenHome(subscription.configDir, home)}</p>
          <p data-testid="subscription-account" className={cn('truncate text-sm', !account && 'text-muted-foreground')}>
            {account ?? (subscription.account.kind === 'error' ? subscription.account.message : ' ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {active ? null : (
            <Button variant="outline" size="sm" data-testid="make-active" onClick={() => void window.oniko.subscriptions.setActive(subscription.id)}>
              Make active
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh login status"
                disabled={checking}
                onClick={() => void window.oniko.subscriptions.refresh(subscription.id)}
              >
                <RefreshCw className={cn(checking && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh login status</TooltipContent>
          </Tooltip>
          <Tooltip>
            {/* A disabled button gets no pointer events, so the tooltip hangs off a wrapper. */}
            <TooltipTrigger asChild>
              <span tabIndex={removeReason ? 0 : -1}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove subscription"
                  data-testid="remove-subscription"
                  disabled={removeReason !== null}
                  onClick={() => void window.oniko.subscriptions.remove(subscription.id)}
                >
                  <Trash2 />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{removeReason ? `${removeReason}. Remove those threads first, or keep it.` : 'Remove'}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {removeReason ? <p className="text-xs text-muted-foreground">{removeReason}</p> : null}
      {subscription.account.kind === 'logged_out' ? <LoginHint subscription={subscription} /> : null}
    </Card>
  )
}

export function SettingsView({ state, threads, home }: { state: SubscriptionsState; threads: Thread[]; home: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="settings-view">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Subscriptions</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Each subscription is a Claude config folder with its own login. New threads start on the active one, and a thread
              stays on the subscription it started with.
            </p>
          </div>
          <AddSubscriptionDialog home={home} added={state.subscriptions} />
        </div>
        {state.subscriptions.length === 0 ? (
          <Card className="items-center px-6 py-10 text-center shadow-none">
            <p className="text-sm text-muted-foreground">No subscriptions yet. Add one to start a thread.</p>
          </Card>
        ) : null}
        {state.subscriptions.map((sub) => (
          <SubscriptionRow
            key={sub.id}
            subscription={sub}
            active={sub.id === state.activeSubscriptionId}
            usedBy={threads.filter((t) => t.subscriptionId === sub.id).length}
            home={home}
          />
        ))}
      </div>
    </div>
  )
}
