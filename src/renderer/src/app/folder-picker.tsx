import { ChevronDown, FolderOpen } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { basename } from './format'

export function FolderPicker({ cwd, recent, onPick }: { cwd: string | null; recent: string[]; onPick: (cwd: string) => void }) {
  const choose = async () => {
    const picked = await window.oniko.dialog.pickFolder()
    if (picked) onPick(picked)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md underline decoration-muted-foreground/50 decoration-dotted underline-offset-[6px] outline-none hover:decoration-foreground">
        {cwd ? basename(cwd) : 'a project'}
        <ChevronDown className="size-5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-72">
        {recent.map((path) => (
          <DropdownMenuItem key={path} onSelect={() => onPick(path)} className="flex flex-col items-start gap-0">
            <span className="text-sm">{basename(path)}</span>
            <span className="w-full truncate text-xs text-muted-foreground">{path}</span>
          </DropdownMenuItem>
        ))}
        {recent.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={() => void choose()}>
          <FolderOpen className="size-4" />
          Choose folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
