import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cwd = process.env.ONIKO_SMOKE_CWD ?? mkdtempSync(join(tmpdir(), 'oniko-smoke-project-'))
const userData = mkdtempSync(join(tmpdir(), 'oniko-smoke-userdata-'))
const shot = resolve(process.env.ONIKO_SMOKE_SHOT ?? join(root, 'smoke-artifacts', 'smoke.png'))
const shotVariant = (suffix) => shot.replace(/\.png$/, `-${suffix}.png`)
mkdirSync(dirname(shot), { recursive: true })

const TURN_TIMEOUT = 90_000
// Set on purpose: if the app inherited it, every session and login probe would point at a dir that does not exist.
const BOGUS_CONFIG_DIR = join(tmpdir(), 'oniko-smoke-bogus-claude-config-dir')
const SUBSCRIPTION_DIRS = [{ typed: '~/.claude', dir: join(homedir(), '.claude') }, { typed: '~/.claude-personal/', dir: join(homedir(), '.claude-personal') }]
let app

function assert(ok, message) {
  if (!ok) throw new Error(`assertion failed: ${message}`)
  console.log(`ok - ${message}`)
}

async function launch() {
  app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: { ...process.env, ONIKO_USER_DATA: userData, ONIKO_SMOKE_CWD: cwd, CLAUDE_CONFIG_DIR: BOGUS_CONFIG_DIR },
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 840 })
  await page.waitForSelector('textarea[aria-label="Prompt"]')
  return page
}

async function send(page, text) {
  const input = page.locator('textarea[aria-label="Prompt"]')
  await input.fill(text)
  await input.press('Enter')
}

async function newThread(page) {
  await page.locator('[data-testid="new-thread"]').click()
  await page.waitForSelector('h1:has-text("What should we build in")')
}

const turnEnds = (page) => page.locator('[data-item-kind="turn_end"]').count()

async function waitForTurnEnd(page, before) {
  await page.waitForFunction((n) => document.querySelectorAll('[data-item-kind="turn_end"]').length > n, before, { timeout: TURN_TIMEOUT })
}

async function lastAssistantText(page) {
  return (await page.locator('[data-item-kind="assistant"]').last().innerText()).trim()
}

const snapshot = (page) => page.evaluate(() => window.oniko.snapshot())

/** Read-only: the transcript the adapter wrote for this session, if it is under this config dir. */
function sessionFile(configDir, sessionId) {
  const projects = join(configDir, 'projects')
  if (!existsSync(projects)) return null
  for (const project of readdirSync(projects)) {
    const file = join(projects, project, `${sessionId}.jsonl`)
    if (existsSync(file)) return file
  }
  return null
}

const row = (page, dir) => page.locator(`[data-config-dir="${dir}"]`)

async function openSettings(page) {
  await page.locator('[data-testid="open-settings"]').click()
  await page.waitForSelector('[data-testid="settings-view"]')
}

async function addSubscription(page, typed) {
  await page.locator('[data-testid="add-subscription"]').click()
  await page.locator('#subscription-path').fill(typed)
  await page.locator('[data-testid="add-subscription-submit"]').click()
  await page.locator('[data-testid="added-subscription"] [data-account-kind="logged_in"]').waitFor({ timeout: 20_000 })
  assert(true, `added ${typed} through the dialog and it probed as logged in`)
  await page.locator('[data-testid="add-subscription-done"]').click()
  await page.locator('[data-testid="add-subscription-dialog"]').waitFor({ state: 'detached' })
}

async function switchTo(page, subscriptionId) {
  await page.locator('[data-testid="subscription-switcher"]').click()
  await page.locator(`[data-subscription-option="${subscriptionId}"]`).click()
  await page.waitForFunction((id) => window.oniko.snapshot().then((s) => s.subscriptions.activeSubscriptionId === id), subscriptionId)
}

async function newestThread(page) {
  const { threads } = await snapshot(page)
  return threads[0]
}

async function promptOn(page, sub, text) {
  await switchTo(page, sub.id)
  await newThread(page)
  await page.locator('[data-testid="composer-subscription"]', { hasText: sub.label }).waitFor()
  await send(page, text)
  await waitForTurnEnd(page, 0)
  const thread = await newestThread(page)
  assert(thread.subscriptionId === sub.id && thread.acpSessionId, `thread "${text}" started on ${sub.label}`)
  await page.locator('[data-testid="thread-subscription"]', { hasText: sub.label }).waitFor()
  assert(true, `thread header shows its subscription ${sub.label}`)
  return thread
}

function assertSessionUnder(sub, thread, others) {
  const file = sessionFile(sub.configDir, thread.acpSessionId)
  assert(file !== null, `session ${thread.acpSessionId} is stored under ${sub.configDir}`)
  for (const other of others) assert(sessionFile(other.configDir, thread.acpSessionId) === null, `and not under ${other.configDir}`)
  return file
}

/** Adds ~/.claude and ~/.claude-personal by typing them, then runs one turn on each. Returns both subscriptions. */
async function subscriptions(page) {
  await openSettings(page)
  const seeded = row(page, SUBSCRIPTION_DIRS[0].dir)
  await seeded.locator('[data-account-kind="logged_in"]').waitFor({ timeout: 20_000 })
  assert(true, 'first run seeded ~/.claude as Default and it is logged in despite the bogus inherited CLAUDE_CONFIG_DIR')
  await seeded.locator('button[aria-pressed]').click()
  await page.locator('[data-testid="subscription-editor"] [data-testid="remove-subscription"]').click()
  await page.locator('[data-subscription-id]').first().waitFor({ state: 'detached' })
  assert(true, 'an unused subscription can be removed')
  await page.locator('[data-testid="settings-back"]').click()
  await page.locator('[data-testid="no-subscription"]').waitFor()
  assert(true, 'without a subscription the new-thread composer asks for one')
  await openSettings(page)

  for (const { typed } of SUBSCRIPTION_DIRS) await addSubscription(page, typed)
  for (const { dir } of SUBSCRIPTION_DIRS) await row(page, dir).locator('[data-account-kind="logged_in"]').waitFor()
  const probed = (await snapshot(page)).subscriptions.subscriptions
  const emails = SUBSCRIPTION_DIRS.map(({ dir }) => probed.find((s) => s.configDir === dir)?.account.email)
  assert(emails.every(Boolean) && emails[0] !== emails[1], `both subscriptions logged in with different accounts (${emails.join(', ')})`)
  await page.screenshot({ path: shotVariant('settings') })
  console.log(`screenshot: ${shotVariant('settings')}`)
  await page.locator('[data-testid="subscription-switcher"]').click()
  await page.locator('[data-testid="subscription-switcher-menu"]').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: shotVariant('switcher') })
  console.log(`screenshot: ${shotVariant('switcher')}`)
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="subscription-switcher-menu"]').waitFor({ state: 'detached' })
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="settings-view"]').waitFor({ state: 'detached' })
  assert(true, 'Esc leaves Settings')

  const state = (await snapshot(page)).subscriptions.subscriptions
  const [work, personal] = SUBSCRIPTION_DIRS.map(({ dir }) => state.find((s) => s.configDir === dir))
  for (const [sub, other] of [
    [work, personal],
    [personal, work],
  ]) {
    const thread = await promptOn(page, sub, `Reply with exactly: hello from ${sub.label}`)
    assertSessionUnder(sub, thread, [other])
  }
  return { work, personal }
}

async function pong(page) {
  await newThread(page)
  await send(page, 'Reply with exactly: pong')
  await page.locator('[data-item-kind="assistant"]', { hasText: 'pong' }).first().waitFor({ timeout: TURN_TIMEOUT })
  assert(true, 'assistant replied with pong')
  await waitForTurnEnd(page, 0)
  assert((await turnEnds(page)) === 1, 'turn_end rendered after the pong turn')
  await page.screenshot({ path: shot })
  console.log(`screenshot: ${shot}`)
  await page.locator('[data-sidebar="trigger"]').click()
  await page.waitForSelector('[data-slot="sidebar"][data-state="collapsed"]')
  await page.waitForTimeout(400)
  await page.screenshot({ path: shotVariant('collapsed') })
  console.log(`screenshot: ${shotVariant('collapsed')}`)
  await page.locator('[data-sidebar="trigger"]').click()
  await page.waitForSelector('[data-slot="sidebar"][data-state="expanded"]')
}

async function approveShellCommand(page) {
  await newThread(page)
  // Claude Code auto-approves read-only commands like a bare echo, so the command writes a file to force a prompt.
  await send(page, 'Run the shell command: echo oniko-ok > oniko-ok.txt')
  const allow = page.locator('[data-permission-state="pending"] button[data-option-kind="allow_once"]').first()
  await allow.waitFor({ timeout: TURN_TIMEOUT })
  assert(true, 'permission card appeared for the shell command')
  await page.screenshot({ path: shotVariant('permission') })
  await allow.click()
  await page.locator('[data-permission-state="approved"]').first().waitFor({ timeout: 10_000 })
  assert(true, 'permission card shows approved')
  await page.locator('[data-tool-status="completed"]').first().waitFor({ state: 'attached', timeout: TURN_TIMEOUT })
  assert(true, 'tool call completed')
  await waitForTurnEnd(page, 0)
  const written = join(cwd, 'oniko-ok.txt')
  assert(existsSync(written) && readFileSync(written, 'utf8').trim() === 'oniko-ok', 'approved command wrote oniko-ok.txt in the project')
  await page.screenshot({ path: shotVariant('tool') })
}

/** The zephyr thread runs on `own`, then `other` is made active before quitting, so the resume must not follow the active one. */
async function rememberAcrossRestart(page, own, other) {
  const thread = await promptOn(page, own, 'Remember the word zephyr. Reply ok.')
  assert(true, 'zephyr turn finished before quitting')
  await switchTo(page, other.id)
  await app.close()

  const relaunched = await launch()
  const row = relaunched.locator('[data-thread-id]', { hasText: 'Remember the word zephyr' }).first()
  await row.waitFor({ timeout: 10_000 })
  assert(true, 'thread is listed after restart')
  await row.locator('button').first().click()
  await relaunched.locator('[data-item-kind="user"]', { hasText: 'Remember the word zephyr' }).waitFor({ timeout: 5_000 })
  assert((await relaunched.locator('[data-item-kind="assistant"]').count()) >= 1, 'earlier messages are visible after restart')
  const before = await turnEnds(relaunched)
  await send(relaunched, 'What word did I ask you to remember? Reply with just the word.')
  await waitForTurnEnd(relaunched, before)
  const reply = await lastAssistantText(relaunched)
  assert(/zephyr/i.test(reply), `resumed session remembered the word (reply: ${JSON.stringify(reply)})`)
  assert(
    (await relaunched.locator('[data-item-kind="notice"]', { hasText: 'fresh agent session' }).count()) === 0,
    'no fresh-session fallback notice',
  )
  const after = (await snapshot(relaunched)).threads.find((t) => t.id === thread.id)
  assert(after.subscriptionId === own.id && after.acpSessionId === thread.acpSessionId, 'thread kept its subscription and session across restart')
  assert((await snapshot(relaunched)).subscriptions.activeSubscriptionId === other.id, 'active subscription persisted across restart')
  await relaunched.locator('[data-testid="thread-subscription"]', { hasText: own.label }).waitFor()
  const file = assertSessionUnder(own, after, [other])
  assert(readFileSync(file, 'utf8').includes('What word did I ask you to remember'), `resumed turn was written to ${own.label}'s transcript`)
  await relaunched.screenshot({ path: shotVariant('resume') })
}

try {
  console.log(`project: ${cwd}\nuserData: ${userData}`)
  const page = await launch()
  const { work, personal } = await subscriptions(page)
  await pong(page)
  await approveShellCommand(page)
  await rememberAcrossRestart(page, work, personal)
  console.log('smoke: all cases passed')
} catch (error) {
  console.error(error)
  try {
    const [win] = app?.windows() ?? []
    if (win) await win.screenshot({ path: shotVariant('failure') })
  } catch {}
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
}
