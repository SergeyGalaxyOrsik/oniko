import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
    env: { ...process.env, ONIKO_USER_DATA: userData, ONIKO_SMOKE_CWD: cwd },
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

async function pong(page) {
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

async function rememberAcrossRestart(page) {
  await newThread(page)
  await send(page, 'Remember the word zephyr. Reply ok.')
  await waitForTurnEnd(page, 0)
  assert(true, 'zephyr turn finished before quitting')
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
  await relaunched.screenshot({ path: shotVariant('resume') })
}

try {
  console.log(`project: ${cwd}\nuserData: ${userData}`)
  const page = await launch()
  await pong(page)
  await approveShellCommand(page)
  await rememberAcrossRestart(page)
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
