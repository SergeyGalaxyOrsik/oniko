import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AuthMethod } from '@agentclientprotocol/sdk'
import { AGENTS } from '@shared/agents'
import type { Thread } from '@shared/thread'

export function AuthCard({ thread, methods }: { thread: Thread; methods: AuthMethod[] }) {
  const label = AGENTS[thread.agentId].label
  return (
    <div data-testid="auth-required" className="rounded-2xl border border-amber-500/40 bg-amber-50 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-amber-800">
        <KeyRound className="size-4" />
        {label} needs you to sign in
      </div>
      <p className="mt-1.5 text-muted-foreground">
        Pick a sign-in method below, or log in with the {label} CLI in a terminal and send your message again.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {methods.map((method) => (
          <Button key={method.id} size="sm" variant="secondary" onClick={() => void window.oniko.threads.authenticate(thread.id, method.id)}>
            {method.name}
          </Button>
        ))}
      </div>
    </div>
  )
}
