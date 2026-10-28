import * as React from "react"
import { SquarePen } from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { AGENT_IDS, AGENTS } from "@shared/agents"
import type { Thread, ThreadId } from "@shared/thread"

export function AppSidebar({
  threads,
  selectedId,
  onSelectThread,
  onNew,
  ...props
}: {
  threads: Thread[]
  selectedId: ThreadId | null
  onSelectThread: (id: ThreadId) => void
  onNew: () => void
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      {/* The top strip clears the macOS traffic lights and drags the window. */}
      <SidebarHeader className="drag pt-10">
        <SidebarMenu>
          <SidebarMenuItem className="px-2 pb-1">
            <span className="text-base font-semibold tracking-tight">Oniko</span>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onNew} className="no-drag" tooltip="New thread" data-testid="new-thread">
              <SquarePen />
              <span>New thread</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain threads={threads} selectedId={selectedId} onSelect={onSelectThread} />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        {AGENT_IDS.map((id) => (
          <NavUser key={id} agent={AGENTS[id]} status={threads.find((t) => t.agentId === id)?.status ?? null} />
        ))}
      </SidebarFooter>
    </Sidebar>
  )
}
