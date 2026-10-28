import { useEffect, useState } from 'react'
import { PromptInput } from '@/components/agents/prompt-input'
import { AGENT_IDS, AGENTS, type AgentId } from '@shared/agents'
import type { ConfigControl } from '@shared/thread'
import { ConfigSelect } from './config-select'
import { AgentGlyph } from './agent-glyph'

export type ComposerProps = {
  busy: boolean
  disabled?: boolean
  config: ConfigControl[]
  onSend: (text: string) => void
  onStop: () => void
  onConfig: (configId: string, value: string) => void
  agent?: { value: AgentId; onChange: (agent: AgentId) => void }
}

export function Composer({ busy, disabled = false, config, onSend, onStop, onConfig, agent }: ComposerProps) {
  const [text, setText] = useState('')

  useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onStop])

  const showAgentPicker = agent !== undefined && AGENT_IDS.length > 1
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
      className="bg-card shadow-[0_8px_30px_rgb(0_0_0/0.35)]"
      models={showAgentPicker ? AGENT_IDS.map((id) => ({ value: id, label: AGENTS[id].label, icon: <AgentGlyph agentId={id} /> })) : []}
      model={agent?.value}
      onModelChange={(id) => agent?.onChange(id as AgentId)}
      leadingAction={
        <>
          {!showAgentPicker && agent ? (
            <span className="flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground">
              <AgentGlyph agentId={agent.value} />
              {AGENTS[agent.value].label}
            </span>
          ) : null}
          {config.map((control) => (
            <ConfigSelect key={control.id} control={control} disabled={busy} onChange={(value) => onConfig(control.id, value)} />
          ))}
        </>
      }
    />
  )
}
