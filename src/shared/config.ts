import type { SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk'
import type { ConfigControl } from './thread'

/** The pre-configOptions `models` field some adapters (Codex) still return from session/new. */
export type LegacyModelState = {
  currentModelId: string
  availableModels: { modelId: string; name: string; description?: string | null }[]
}

export function controlsFromConfigOptions(options: SessionConfigOption[]): ConfigControl[] {
  return options.flatMap((option): ConfigControl[] => {
    if (option.type !== 'select') return []
    const flat = option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]))
    return [
      {
        id: option.id,
        label: option.name,
        source: 'config_option',
        value: option.currentValue,
        options: flat.map((o) => ({ value: o.value, label: o.name, ...(o.description ? { description: o.description } : {}) })),
      },
    ]
  })
}

export function controlFromModes(modes: SessionModeState): ConfigControl {
  return {
    id: 'mode',
    label: 'Mode',
    source: 'mode',
    value: modes.currentModeId,
    options: modes.availableModes.map((m) => ({ value: m.id, label: m.name, ...(m.description ? { description: m.description } : {}) })),
  }
}

export function controlFromModels(models: LegacyModelState): ConfigControl {
  return {
    id: 'model',
    label: 'Model',
    source: 'model',
    value: models.currentModelId,
    options: models.availableModels.map((m) => ({ value: m.modelId, label: m.name, ...(m.description ? { description: m.description } : {}) })),
  }
}

/** configOptions supersede the legacy fields; legacy controls fill only what configOptions lack. */
export function normalizeConfig(input: {
  configOptions?: SessionConfigOption[] | null
  modes?: SessionModeState | null
  models?: LegacyModelState | null
}): ConfigControl[] {
  const controls = input.configOptions ? controlsFromConfigOptions(input.configOptions) : []
  const has = (id: string) => controls.some((c) => c.id === id)
  if (input.modes && !has('mode')) controls.push(controlFromModes(input.modes))
  if (input.models && !has('model')) controls.push(controlFromModels(input.models))
  return controls
}

export function withValue(config: ConfigControl[], id: string, value: string): ConfigControl[] {
  return config.map((c) => (c.id === id ? { ...c, value } : c))
}
