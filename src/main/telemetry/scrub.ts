export type ScrubContext = { home: string; user: string; appPath: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The same path as written natively, with forward slashes, and URL-encoded. */
function spellings(path: string): string[] {
  const forward = path.replaceAll('\\', '/')
  return [...new Set([path, forward, encodeURI(forward)])].filter((p) => p.length > 1)
}

/** Strips what could identify the user from an error message or stack: app paths, home, username. */
export function scrub(text: string, { home, user, appPath }: ScrubContext): string {
  let out = text
  for (const p of spellings(appPath)) {
    out = out.replace(new RegExp(`file:///?${escape(p.replace(/^\//, ''))}[\\\\/]?`, 'gi'), '')
    out = out.replace(new RegExp(`${escape(p)}[\\\\/]?`, 'gi'), '')
  }
  for (const p of spellings(home)) out = out.replace(new RegExp(escape(p), 'gi'), '~')
  // A one-letter name would mangle every message; such a name is not much of an identifier anyway.
  if (user.length >= 2) out = out.replace(new RegExp(`(?<![a-z0-9])${escape(user)}(?![a-z0-9])`, 'gi'), '<user>')
  return out
}

export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
