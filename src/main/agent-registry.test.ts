import { describe, expect, it } from 'vitest'
import { childEnv, claudeEnvFor, claudeLoginCommand, normalizeConfigDir, parseClaudeAuthStatus } from './agent-registry'

const home = '/Users/someone'

describe('normalizeConfigDir', () => {
  it('expands ~ and drops trailing slashes', () => {
    expect(normalizeConfigDir('~/.claude-personal/', home)).toBe('/Users/someone/.claude-personal')
    expect(normalizeConfigDir('~', home)).toBe(home)
    expect(normalizeConfigDir('  /opt/claude//work/../team/  ', home)).toBe('/opt/claude/team')
  })

  it('rejects relative paths', () => {
    expect(normalizeConfigDir('.claude', home)).toBeNull()
    expect(normalizeConfigDir('~other/.claude', home)).toBeNull()
  })
})

describe('claude env rule', () => {
  it('unsets CLAUDE_CONFIG_DIR for the default dir and sets it for any other', () => {
    expect(claudeEnvFor('/Users/someone/.claude', home)).toEqual({ CLAUDE_CONFIG_DIR: undefined })
    expect(claudeEnvFor('/Users/someone/.claude-personal', home)).toEqual({ CLAUDE_CONFIG_DIR: '/Users/someone/.claude-personal' })
  })

  it('treats ~/.claude/ typed with a trailing slash as the default dir', () => {
    const dir = normalizeConfigDir('~/.claude/', home)!
    expect(claudeEnvFor(dir, home)).toEqual({ CLAUDE_CONFIG_DIR: undefined })
  })

  it('never lets an inherited CLAUDE_CONFIG_DIR reach the child', () => {
    const inherited = { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/bogus' }
    expect(childEnv(inherited, { ELECTRON_RUN_AS_NODE: '1' }, claudeEnvFor('/Users/someone/.claude', home))).toEqual({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
    })
    expect(childEnv(inherited, claudeEnvFor('/Users/someone/.claude-work', home))['CLAUDE_CONFIG_DIR']).toBe('/Users/someone/.claude-work')
  })

  it('prints the login command the user can paste', () => {
    expect(claudeLoginCommand('/Users/someone/.claude', home)).toBe('claude auth login')
    expect(claudeLoginCommand('/Users/someone/.claude-personal', home)).toBe('CLAUDE_CONFIG_DIR=/Users/someone/.claude-personal claude auth login')
    expect(claudeLoginCommand("/Users/some one/it's", home)).toBe(`CLAUDE_CONFIG_DIR='/Users/some one/it'\\''s' claude auth login`)
  })
})

describe('parseClaudeAuthStatus', () => {
  // Recorded from `claude auth status --json` 2.1.310, with the account details replaced.
  const loggedIn = JSON.stringify({
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    email: 'dev@example.com',
    orgId: '00000000-0000-0000-0000-000000000000',
    orgName: 'Example Org',
    subscriptionType: 'max',
    configDirectory: '/Users/someone/.claude-personal',
  })
  const loggedOut = JSON.stringify({
    loggedIn: false,
    authMethod: 'none',
    apiProvider: 'firstParty',
    configDirectory: '/tmp/empty',
  })

  it('reads a logged-in account', () => {
    expect(parseClaudeAuthStatus(loggedIn, 7)).toEqual({
      kind: 'logged_in',
      email: 'dev@example.com',
      orgName: 'Example Org',
      plan: 'max',
      checkedAt: 7,
    })
  })

  it('reads a logged-out dir', () => {
    expect(parseClaudeAuthStatus(loggedOut, 7)).toEqual({ kind: 'logged_out', checkedAt: 7 })
  })

  it('reports garbage as an error instead of throwing', () => {
    expect(parseClaudeAuthStatus('Not logged in. Run claude auth login', 7)).toMatchObject({ kind: 'error', checkedAt: 7 })
    expect(parseClaudeAuthStatus('{"loggedIn":"yes"}', 7)).toMatchObject({ kind: 'error' })
    expect(parseClaudeAuthStatus('', 7)).toMatchObject({ kind: 'error' })
  })
})
