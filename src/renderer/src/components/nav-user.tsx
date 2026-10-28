import { ChevronsUpDown } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { AgentGlyph } from "@/app/agent-glyph"
import { cn } from "@/lib/utils"
import type { AgentInfo } from "@shared/agents"
import type { ThreadStatus } from "@shared/thread"

/** What the footer chip can honestly say about an agent, derived from the newest thread's status. */
const CONNECTION: Record<ThreadStatus["kind"] | "none", { label: string; dot: string }> = {
  none: { label: "Not started", dot: "bg-muted-foreground/40" },
  dormant: { label: "Not connected", dot: "bg-muted-foreground/40" },
  exited: { label: "Not connected", dot: "bg-muted-foreground/40" },
  connecting: { label: "Connecting…", dot: "bg-sky-500 animate-pulse" },
  idle: { label: "Connected", dot: "bg-emerald-500" },
  running: { label: "Working", dot: "bg-sky-500 animate-pulse" },
  awaiting_permission: { label: "Waiting for approval", dot: "bg-amber-500" },
  auth_required: { label: "Needs sign-in", dot: "bg-amber-500" },
  error: { label: "Failed to start", dot: "bg-red-500" },
}

export function NavUser({ agent, status }: { agent: AgentInfo; status: ThreadStatus | null }) {
  const { isMobile } = useSidebar()
  const connection = CONNECTION[status?.kind ?? "none"]

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="agent-chip"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-background">
                  <AgentGlyph agentId={agent.id} className="size-4" />
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{agent.label}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <span className={cn("size-1.5 shrink-0 rounded-full", connection.dot)} />
                  {connection.label}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium">{agent.label}</div>
              <div className="text-xs text-muted-foreground">{agent.description}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Subscription management is coming soon</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
