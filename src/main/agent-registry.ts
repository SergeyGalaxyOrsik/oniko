import { execFile } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentId } from '@shared/agents'
import type { AccountStatus } from '@shared/subscriptions'

/** An `undefined` value removes the variable from the child env rather than inheriting it. */
export type EnvLayer = Record<string, string | undefined>

export type SpawnSpec = { command: string; args: string[]; env: Record<string, string> }

export type AccountSpec = {
  envFor(configDir: string): EnvLayer
  probeStatus(configDir: string): Promise<AccountStatus>
  /** Existing config dirs worth suggesting when adding a subscription. */
  defaultDirs(): string[]
  loginCommand(configDir: string): string
}

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

export function childEnv(base: NodeJS.ProcessEnv, ...layers: EnvLayer[]): Record<string, string> {
  const merged: EnvLayer = Object.assign({}, base, ...layers)
  return Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

/** Expands `~`, drops trailing slashes and `..`; null when the input is not an absolute path. */
export function normalizeConfigDir(input: string, home = homedir()): string | null {
  const trimmed = input.trim()
  const expanded = trimmed === '~' ? home : trimmed.startsWith('~/') ? join(home, trimmed.slice(2)) : trimmed
  return isAbsolute(expanded) ? resolve(expanded) : null
}

/**
 * Claude keys the default login to an unset CLAUDE_CONFIG_DIR: setting it to ~/.claude reads a
 * different keychain entry and reports logged out. So the default dir unsets it, and every other
 * dir sets it, which also keeps whatever Oniko was launched with from leaking through.
 */
export function claudeEnvFor(configDir: string, home = homedir()): EnvLayer {
  return { CLAUDE_CONFIG_DIR: configDir === join(home, '.claude') ? undefined : configDir }
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
}

export function claudeLoginCommand(configDir: string, home = homedir()): string {
  const dir = claudeEnvFor(configDir, home)['CLAUDE_CONFIG_DIR']
  return dir === undefined ? 'claude auth login' : `CLAUDE_CONFIG_DIR=${shellQuote(dir)} claude auth login`
}

const authStatus = z.object({
  loggedIn: z.boolean(),
  email: z.string().nullish(),
  orgName: z.string().nullish(),
  subscriptionType: z.string().nullish(),
})

export function parseClaudeAuthStatus(stdout: string, now: number): AccountStatus {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return { kind: 'error', message: `Unexpected output from claude auth status: ${stdout.trim().slice(0, 200) || '(empty)'}`, checkedAt: now }
  }
  const parsed = authStatus.safeParse(json)
  if (!parsed.success) return { kind: 'error', message: 'claude auth status returned an unexpected shape', checkedAt: now }
  const s = parsed.data
  if (!s.loggedIn) return { kind: 'logged_out', checkedAt: now }
  return { kind: 'logged_in', email: s.email ?? null, orgName: s.orgName ?? null, plan: s.subscriptionType ?? null, checkedAt: now }
}

/**
 * The CLI bundled with the adapter, not a global `claude`: an app launched from Finder has a
 * minimal PATH, and this is the same binary the adapter runs sessions with.
 */
function claudeCliPath(): string {
  const acp = resolver.resolve('@agentclientprotocol/claude-agent-acp/package.json')
  const sdk = createRequire(acp).resolve('@anthropic-ai/claude-agent-sdk')
  return createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`)
}

const PROBE_TIMEOUT_MS = 10_000

function probeClaude(configDir: string): Promise<AccountStatus> {
  return new Promise((done) => {
    let cli: string
    try {
      cli = claudeCliPath()
    } catch (error) {
      done({ kind: 'error', message: `Claude CLI not found: ${error instanceof Error ? error.message : String(error)}`, checkedAt: Date.now() })
      return
    }
    // A logged-out dir exits 1 with valid JSON on stdout, so stdout is parsed whatever the exit code.
    execFile(
      cli,
      ['auth', 'status', '--json'],
      { env: childEnv(process.env, claudeEnvFor(configDir)), timeout: PROBE_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error && !stdout.trim()) {
          const message = error.killed ? 'claude auth status timed out' : stderr.trim() || error.message
          done({ kind: 'error', message, checkedAt: Date.now() })
          return
        }
        done(parseClaudeAuthStatus(stdout, Date.now()))
      },
    )
  })
}

function claudeDirs(home = homedir()): string[] {
  return readdirSync(home)
    .filter((name) => /^\.claude(-.+)?$/.test(name))
    .map((name) => join(home, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

export const ACCOUNT_SPECS: Record<AgentId, AccountSpec> = {
  claude: {
    envFor: (configDir) => claudeEnvFor(configDir),
    probeStatus: probeClaude,
    defaultDirs: () => claudeDirs(),
    loginCommand: (configDir) => claudeLoginCommand(configDir),
  },
}
