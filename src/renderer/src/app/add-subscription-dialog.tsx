import { useEffect, useState, type FormEvent } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AGENT_IDS } from '@shared/agents'
import { accountLine, type Subscription } from '@shared/subscriptions'
import { AccountBadge, LoginHint, shortenHome } from './subscription-ui'

type Phase = { kind: 'editing'; error: string | null } | { kind: 'adding' } | { kind: 'added'; subscription: Subscription }

/** `compact` renders the toolbar "+" icon instead of the labelled button. */
export function AddSubscriptionDialog({ home, added, compact = false }: { home: string; added: Subscription[]; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'editing', error: null })
  const [suggestions, setSuggestions] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setPath('')
    setLabel('')
    setPhase({ kind: 'editing', error: null })
    void window.oniko.subscriptions.detect().then(setSuggestions)
  }, [open])

  // The added row keeps updating in the store (a refresh, a rename), so show its live copy.
  const result = phase.kind === 'added' ? (added.find((s) => s.id === phase.subscription.id) ?? phase.subscription) : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!path.trim()) {
      setPhase({ kind: 'editing', error: 'Enter the folder the subscription lives in' })
      return
    }
    setPhase({ kind: 'adding' })
    const res = await window.oniko.subscriptions.add({ agentId: AGENT_IDS[0]!, configDir: path, ...(label.trim() ? { label } : {}) })
    setPhase(res.ok ? { kind: 'added', subscription: res.subscription } : { kind: 'editing', error: res.error })
  }

  const browse = async () => {
    const picked = await window.oniko.dialog.pickFolder({ showHidden: true })
    if (picked) setPath(shortenHome(picked, home))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Add subscription"
                data-testid="add-subscription"
              >
                <Plus />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">Add subscription</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Plus />
            Add subscription
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md" data-testid="add-subscription-dialog">
        <DialogHeader>
          <DialogTitle>{result ? 'Subscription added' : 'Add a subscription'}</DialogTitle>
          <DialogDescription>
            {result
              ? 'New threads can start on it now.'
              : 'Point to a Claude config folder, like ~/.claude or ~/.claude-work. Each folder keeps its own login.'}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3" data-testid="added-subscription">
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{result.label}</span>
                <AccountBadge account={result.account} />
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{shortenHome(result.configDir, home)}</p>
              {accountLine(result.account) ? <p className="mt-1 text-sm">{accountLine(result.account)}</p> : null}
            </div>
            {result.account.kind === 'logged_out' ? <LoginHint subscription={result} /> : null}
            <DialogFooter>
              <Button onClick={() => setOpen(false)} data-testid="add-subscription-done">
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subscription-path">Folder</Label>
              <div className="flex gap-2">
                <Input
                  id="subscription-path"
                  value={path}
                  autoFocus
                  spellCheck={false}
                  placeholder="~/.claude-work"
                  className="font-mono text-sm"
                  aria-invalid={phase.kind === 'editing' && phase.error !== null}
                  onChange={(e) => setPath(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={() => void browse()}>
                  <FolderOpen />
                  Browse…
                </Button>
              </div>
              {suggestions.length ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                  Detected:
                  {suggestions.map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      data-suggestion={dir}
                      onClick={() => setPath(shortenHome(dir, home))}
                      className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-foreground hover:bg-muted"
                    >
                      {shortenHome(dir, home)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-label">
                Name <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="subscription-label" value={label} placeholder="Defaults to the folder name" onChange={(e) => setLabel(e.target.value)} />
            </div>
            {phase.kind === 'editing' && phase.error ? (
              <p role="alert" data-testid="add-subscription-error" className="text-sm text-destructive">
                {phase.error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={phase.kind === 'adding'} data-testid="add-subscription-submit">
                {phase.kind === 'adding' ? 'Checking login…' : 'Add subscription'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
