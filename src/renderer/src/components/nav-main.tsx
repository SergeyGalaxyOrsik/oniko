import { ChevronRight, Folder } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { basename, relativeTime } from "@/app/format"
import { useNow } from "@/app/use-now"
import { cn } from "@/lib/utils"
import type { Thread, ThreadId, ThreadStatus } from "@shared/thread"

const DOT: Partial<Record<ThreadStatus["kind"], string>> = {
  connecting: "bg-sky-500 animate-pulse",
  running: "bg-sky-500 animate-pulse",
  awaiting_permission: "bg-amber-500",
  auth_required: "bg-amber-500",
  error: "bg-red-500",
}

export function NavMain({
  threads,
  selectedId,
  onSelect,
}: {
  threads: Thread[]
  selectedId: ThreadId | null
  onSelect: (id: ThreadId) => void
}) {
  const now = useNow(30_000)
  const projects = new Map<string, Thread[]>()
  for (const thread of threads) projects.set(thread.cwd, [...(projects.get(thread.cwd) ?? []), thread])

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarMenu>
        {threads.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">No threads yet.</p> : null}
        {[...projects].map(([cwd, list]) => (
          <Collapsible key={cwd} asChild defaultOpen>
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={cwd}>
                  <Folder />
                  <span>{basename(cwd)}</span>
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleTrigger asChild>
                <SidebarMenuAction className="data-[state=open]:rotate-90">
                  <ChevronRight />
                  <span className="sr-only">Toggle</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {list.map((thread) => (
                    <SidebarMenuSubItem key={thread.id} data-thread-id={thread.id}>
                      <SidebarMenuSubButton asChild isActive={thread.id === selectedId}>
                        <button type="button" onClick={() => onSelect(thread.id)} className="w-full">
                          <span className="min-w-0 flex-1 truncate">{thread.title || "New thread"}</span>
                          {DOT[thread.status.kind] ? (
                            <span aria-label={thread.status.kind} className={cn("size-1.5 shrink-0 rounded-full", DOT[thread.status.kind])} />
                          ) : null}
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relativeTime(thread.createdAt, now)}</span>
                        </button>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
