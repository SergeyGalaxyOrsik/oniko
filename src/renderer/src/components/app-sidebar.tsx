import * as React from "react"
import { SquarePen } from "lucide-react"
import logo from "@/assets/oniko.svg"

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
import type { SubscriptionsState } from "@shared/subscriptions"
import type { TasksState } from "@shared/tasks"
import type { Thread, ThreadId } from "@shared/thread"

export function AppSidebar({
  threads,
  selectedId,
  onSelectThread,
  tasks,
  tasksProject,
  onOpenTasks,
  onNew,
  settingsOpen,
  onOpenSettings,
  subscriptions,
  ...props
}: {
  threads: Thread[]
  selectedId: ThreadId | null
  onSelectThread: (id: ThreadId) => void
  tasks: TasksState
  tasksProject: string | null
  onOpenTasks: (project: string) => void
  onNew: () => void
  settingsOpen: boolean
  onOpenSettings: () => void
  subscriptions: SubscriptionsState
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      {/* The top strip clears the macOS traffic lights and drags the window. */}
      <SidebarHeader className="drag pt-10">
        <SidebarMenu>
          <SidebarMenuItem className="px-2 pb-1">
            <span className="flex items-center gap-2">
              <img src={logo} alt="" aria-hidden="true" className="size-5 rounded-[5px]" draggable={false} />
              <span className="text-base font-semibold tracking-tight">Oniko</span>
            </span>
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
        <NavMain
          threads={threads}
          subscriptions={subscriptions}
          selectedId={selectedId}
          onSelect={onSelectThread}
          tasks={tasks}
          tasksProject={tasksProject}
          onOpenTasks={onOpenTasks}
        />
        <NavSecondary className="mt-auto" settingsOpen={settingsOpen} onOpenSettings={onOpenSettings} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser state={subscriptions} onManage={onOpenSettings} />
      </SidebarFooter>
    </Sidebar>
  )
}
