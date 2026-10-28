import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { AgentId } from '@shared/agents'

export type SpawnSpec = { command: string; args: string[]; env: Record<string, string> }

const resolver = createRequire(import.meta.url)

/** Runs a package's bin from node_modules with Electron's own Node, so no system node or npx is needed. */
function packageBin(pkg: string, bin: string): SpawnSpec {
  const manifestPath = resolver.resolve(`${pkg}/package.json`)
  const manifest: { bin: Record<string, string> } = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const binPath = manifest.bin[bin]
  if (!binPath) throw new Error(`${pkg} has no bin named ${bin}`)
  return { command: process.execPath, args: [join(dirname(manifestPath), binPath)], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

export const SPAWN_SPECS: Record<AgentId, () => SpawnSpec> = {
  claude: () => packageBin('@agentclientprotocol/claude-agent-acp', 'claude-agent-acp'),
}
