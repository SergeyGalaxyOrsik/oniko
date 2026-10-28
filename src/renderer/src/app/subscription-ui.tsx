import { useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AccountStatus, Subscription } from '@shared/subscriptions'

export const ACCOUNT_STATUS: Record<AccountStatus['kind'], { label: string; dot: string; badge: string }> = {
  unknown: { label: 'Not checked', dot: 'bg-muted-foreground/40', badge: 'text-muted-foreground' },
  checking: { label: 'Checking', dot: 'bg-sky-500 animate-pulse', badge: 'text-sky-700' },
  logged_in: { label: 'Logged in', dot: 'bg-emerald-500', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  logged_out: { label: 'Logged out', dot: 'bg-amber-500', badge: 'border-amber-200 bg-amber-50 text-amber-800' },
  error: { label: 'Error', dot: 'bg-red-500', badge: 'border-red-200 bg-red-50 text-red-700' },
}

export function StatusDot({ account, className }: { account: AccountStatus; className?: string }) {
  return <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', ACCOUNT_STATUS[account.kind].dot, className)} />
}

export function AccountBadge({ account }: { account: AccountStatus }) {
  const status = ACCOUNT_STATUS[account.kind]
  const badge = (
    <Badge variant="outline" data-account-kind={account.kind} className={cn('gap-1.5 font-normal', status.badge)}>
      <StatusDot account={account} />
      {status.label}
    </Badge>
  )
  if (account.kind !== 'error') return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-80">{account.message}</TooltipContent>
    </Tooltip>
  )
}

export function shortenHome(path: string, home: string): string {
  if (!home) return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}

/** The app does not run the login flow itself; it shows the exact command for this config dir. */
export function LoginHint({ subscription, className }: { subscription: Subscription; className?: string }) {
  return (
    <div data-testid="login-hint" className={cn('rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm', className)}>
      <p className="text-amber-900">
        <span className="font-medium">{subscription.label}</span> is logged out. Run this in a terminal, then refresh.
      </p>
      <div className="mt-2 flex items-center gap-1 rounded-md border bg-background py-1 pr-1 pl-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{subscription.loginCommand}</code>
        <CopyButton text={subscription.loginCommand} label="Copy login command" />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={subscription.account.kind === 'checking'}
          onClick={() => void window.oniko.subscriptions.refresh(subscription.id)}
        >
          <RefreshCw className={cn(subscription.account.kind === 'checking' && 'animate-spin')} />
          Refresh
        </Button>
      </div>
    </div>
  )
}
