import { ChevronsUpDown, Settings } from "lucide-react"

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
import { SubscriptionMenuItems } from "@/app/subscription-picker"
import { ACCOUNT_STATUS, StatusDot } from "@/app/subscription-ui"
import { activeSubscription, type SubscriptionsState } from "@shared/subscriptions"

/** The footer chip is the subscription switcher: it shows the active one and lists every subscription. */
export function NavUser({ state, onManage }: { state: SubscriptionsState; onManage: () => void }) {
  const { isMobile } = useSidebar()
  const active = activeSubscription(state)
  const detail = active
    ? active.account.kind === "logged_in"
      ? (active.account.email ?? ACCOUNT_STATUS.logged_in.label)
      : ACCOUNT_STATUS[active.account.kind].label
    : "Add one in Settings"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="subscription-switcher"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-background">
                  {active ? <AgentGlyph agentId={active.agentId} className="size-4" /> : <Settings className="size-4" />}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{active?.label ?? "No subscription"}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  {active ? <StatusDot account={active.account} /> : null}
                  <span className="truncate">{detail}</span>
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-testid="subscription-switcher-menu"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-72 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Subscriptions</DropdownMenuLabel>
            <SubscriptionMenuItems
              subscriptions={state.subscriptions}
              activeId={state.activeSubscriptionId}
              onSelect={(id) => void window.oniko.subscriptions.setActive(id)}
            />
            {state.subscriptions.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={onManage} data-testid="manage-subscriptions">
              <Settings />
              Manage subscriptions…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
