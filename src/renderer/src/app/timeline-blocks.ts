import type { TimelineItem, ToolItem } from '@shared/thread'

type Item<K extends TimelineItem['kind']> = Extract<TimelineItem, { kind: K }>

export type TimelineBlock =
  | { kind: 'item'; item: Exclude<TimelineItem, ToolItem> }
  | { kind: 'activity'; id: string; tools: ToolItem[]; live: boolean }

/** Folds each run of consecutive tool calls into one activity group; the last group of a running turn is live. */
export function toBlocks(timeline: TimelineItem[], running: boolean): TimelineBlock[] {
  const blocks: TimelineBlock[] = []
  for (const item of timeline) {
    if (item.kind === 'tool') {
      const last = blocks.at(-1)
      if (last?.kind === 'activity') last.tools.push(item)
      else blocks.push({ kind: 'activity', id: `activity-${item.id}`, tools: [item], live: false })
    } else {
      blocks.push({ kind: 'item', item })
    }
  }
  const last = blocks.at(-1)
  if (running && last?.kind === 'activity') last.live = true
  return blocks
}

export type PermissionItem = Item<'permission'>
export type AssistantItem = Item<'assistant'>
