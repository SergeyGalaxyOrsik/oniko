import { useEffect, useState, type ReactNode } from 'react'
import { PromptInput } from '@/components/agents/prompt-input'
import type { ConfigControl } from '@shared/thread'
import { ConfigSelect } from './config-select'

/** Only these reach the composer; the rest (fast mode, sub-agents, ...) keep the agent's value. */
const SHOWN_CATEGORIES = new Set(['mode', 'model', 'thought_level'])

export type ComposerProps = {
  busy: boolean
  disabled?: boolean
  config: ConfigControl[]
  onSend: (text: string) => void
  onStop: () => void
  onConfig: (configId: string, value: string) => void
  /** The subscription picker; it also names the agent, since a subscription belongs to one. */
  leading?: ReactNode
}

export function Composer({ busy, disabled = false, config, onSend, onStop, onConfig, leading }: ComposerProps) {
  const [text, setText] = useState('')

  useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onStop])

  return (
    <PromptInput
      value={text}
      onValueChange={setText}
      onSubmit={(value) => {
        onSend(value)
        setText('')
      }}
      loading={busy}
      onStop={onStop}
      disabled={disabled}
      placeholder="Ask for changes, send follow-ups…"
      minRows={2}
      maxRows={10}
      className="bg-card shadow-sm"
      leadingAction={
        <>
          {leading}
          {config
            .filter((control) => control.category && SHOWN_CATEGORIES.has(control.category))
            .map((control) => (
              <ConfigSelect key={control.id} control={control} disabled={disabled} onChange={(value) => onConfig(control.id, value)} />
            ))}
        </>
      }
    />
  )
}
