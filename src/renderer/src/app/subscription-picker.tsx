import { Check, ChevronDown, Lock } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { planLabel, type Subscription, type SubscriptionId } from '@shared/subscriptions'
import { AgentGlyph } from './agent-glyph'
import { StatusDot } from './subscription-ui'

export const LOCKED_HINT = 'Threads stay on the subscription they started with'

export function SubscriptionMenuItems({
  subscriptions,
  activeId,
  onSelect,
}: {
  subscriptions: Subscription[]
  activeId: SubscriptionId | null
  onSelect: (id: SubscriptionId) => void
}) {
  return subscriptions.map((sub) => {
    const account = sub.account.kind === 'logged_in' ? [sub.account.email, planLabel(sub.account.plan)].filter(Boolean).join(' · ') : null
    return (
      <DropdownMenuItem key={sub.id} data-subscription-option={sub.id} onSelect={() => onSelect(sub.id)} className="gap-2">
        <StatusDot account={sub.account} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{sub.label}</span>
          {account ? <span className="truncate text-xs text-muted-foreground">{account}</span> : null}
        </span>
        {sub.id === activeId ? <Check className="size-4" /> : <span className="size-4" />}
      </DropdownMenuItem>
    )
  })
}

/** In the composer: picks the subscription a new thread starts on, or names a thread's fixed one. */
export function SubscriptionPicker({
  subscriptions,
  current,
  readOnly,
}: {
  subscriptions: Subscription[]
  current: Subscription | undefined
  readOnly: boolean
}) {
  const label = (
    <>
      {current ? <AgentGlyph agentId={current.agentId} /> : null}
      <span className="max-w-40 truncate">{current?.label ?? 'No subscription'}</span>
    </>
  )
  const chip = 'flex h-8 items-center gap-1.5 rounded-xl px-2 text-xs text-muted-foreground'
  if (readOnly || subscriptions.length < 2) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span data-testid="composer-subscription" className={chip}>
            {label}
            {readOnly ? <Lock className="size-3" /> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent>{readOnly ? LOCKED_HINT : current?.configDir}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid="composer-subscription" className={`${chip} outline-none hover:bg-muted focus-visible:ring-2`}>
        {label}
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Start new threads on</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <SubscriptionMenuItems
          subscriptions={subscriptions}
          activeId={current?.id ?? null}
          onSelect={(id) => void window.oniko.subscriptions.setActive(id)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
