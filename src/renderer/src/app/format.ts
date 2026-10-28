import type { FileDiffLine } from '@/components/agents/file-diff'

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`
}

export function relativeTime(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** A whole-hunk diff: ACP edit diffs are snippets, so old lines then new lines reads correctly. */
export function diffLines(oldText: string | null | undefined, newText: string): FileDiffLine[] {
  const removed = oldText ? oldText.split('\n') : []
  const added = newText.split('\n')
  return [
    ...removed.map((content, i) => ({ id: `r${i}`, type: 'removed' as const, oldLine: i + 1, content })),
    ...added.map((content, i) => ({ id: `a${i}`, type: 'added' as const, newLine: i + 1, content })),
  ]
}
