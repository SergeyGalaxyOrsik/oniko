import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/motion/select'
import type { ConfigControl } from '@shared/thread'

/** Values of these categories read on their own ("Opus 5.5", "Medium"); anything else needs its label ("Fast: Off"). */
const SELF_DESCRIBING = new Set(['model', 'mode', 'thought_level'])

export function ConfigSelect({ control, disabled, onChange }: { control: ConfigControl; disabled: boolean; onChange: (value: string) => void }) {
  const current = control.options.find((o) => o.value === control.value)
  return (
    <Select value={control.value} onValueChange={onChange} disabled={disabled} className="min-w-0">
      <SelectTrigger className="h-8 w-auto max-w-52 rounded-xl border-0 bg-transparent px-2 py-0 text-xs hover:bg-muted focus-visible:ring-2">
        <span data-config-id={control.id} className="truncate text-muted-foreground" title={control.label}>
          {control.category && SELF_DESCRIBING.has(control.category) ? '' : `${control.label}: `}
          {current?.label ?? control.value}
        </span>
      </SelectTrigger>
      <SelectContent className="right-auto max-h-80 w-64 overflow-y-auto shadow-none">
        {control.options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="py-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-foreground">{option.label}</span>
              {option.description ? <span className="truncate text-xs text-muted-foreground">{option.description}</span> : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
