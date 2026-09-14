/**
 * Record the table playing itself, so the animations can be watched frame by
 * frame instead of guessed at.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env tools/record-game.ts
 *
 * This exists because screenshots kept lying. A tab that is not in the
 * foreground has its timers clamped to a second and its animations deferred,
 * so a card mid-deal looks frozen and a 550ms hold measures as 1000ms. A
 * Playwright page is nobody's background tab, so what it records is what the
 * animation actually does.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { db, disconnect } from '@cucumber/database'

const origin = process.env.RECORD_ORIGIN ?? 'http://localhost:5173'
const outDir = process.argv[2] ?? '/tmp/cucumber-recording'
const maxSeconds = Number(process.env.RECORD_SECONDS ?? 150)

/** Sign in as the seated human without touching their existing session. */
async function mintInvite(): Promise<string> {
  const email = (process.env.ADMIN_EMAIL ?? '').toLowerCase()
  if (!email) throw new Error('ADMIN_EMAIL is not set')
  const token = randomBytes(24).toString('base64url')
  await db().user.update({
    where: { email },
    data: { inviteHash: createHash('sha256').update(token).digest('hex') },
  })
  return token
}

/** One move, decided in the page from what is on screen. */
const STEP = `(() => {
  const enabled = (b) => b && !b.disabled
  const reveal = [...document.querySelectorAll('.reveal button')].find(enabled)
  if (reveal) { reveal.click(); return 'reveal:' + reveal.textContent.trim() }
  // "Not yet" un-readies, so clicking whatever is enabled ping-pongs forever.
  const action = [...document.querySelectorAll('.actions button, .count-choice button')]
    .filter((b) => !/^Not yet/.test(b.textContent.trim()))
    .find(enabled)
  if (action) { action.click(); return 'act:' + action.textContent.trim() }
  const advised = [...document.querySelectorAll('.hand button.card.advised')]
  if (advised.length) { advised.forEach(c => c.click()); return 'select:' + advised.length }
  const usable = [...document.querySelectorAll('.hand button.card')].filter(b => !b.disabled)
  if (usable.length) {
    const prompt = document.querySelector('.prompt')?.textContent ?? ''
    const m = prompt.match(/Play (\\\\d+) card|Surrender your (\\\\d+)|Choose (\\\\d+)/)
    const need = m ? Number(m[1] || m[2] || m[3]) : 1
    usable.slice(-need).forEach(c => c.click())
    return 'fallback:' + need
  }
  return 'wait'
})()`

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const token = await mintInvite()
  await disconnect()

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
  })
  // The advisor is remembered per browser, and this one has never been here.
  await context.addInitScript(() => {
    window.localStorage.setItem('cucumber.advisor', 'on')
  })

  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('page error:', message.text())
  })

  // Not networkidle: the app holds a websocket open, so the network is never
  // idle. (The console also shows one 400 here — StrictMode double-fires the
  // sign-in effect in dev and the second redeem finds the invite spent. The
  // first one already set the cookie.)
  await page.goto(`${origin}/invite/${token}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.table, .panel', { timeout: 20_000 })
  await page.waitForTimeout(1200)

  const handNumber = async (): Promise<number> => {
    const text = await page.locator('.brand small').textContent().catch(() => null)
    return Number(text?.replace(/\D/g, '') ?? 0)
  }

  const startedHand = await handNumber()
  const started = Date.now()
  let dealtAgain = 0
  let last = ''

  while ((Date.now() - started) / 1000 < maxSeconds) {
    const result = (await page.evaluate(STEP)) as string
    if (result !== last) {
      console.log(`${((Date.now() - started) / 1000).toFixed(1)}s  ${result}`)
      last = result
    }
    const hand = await handNumber()
    if (hand > startedHand) {
      // A fresh deal is the thing worth watching; give it time to play out.
      if (!dealtAgain) dealtAgain = Date.now()
      if (Date.now() - dealtAgain > 26_000) break
    }
    await page.waitForTimeout(320)
  }

  await context.close()
  await browser.close()
  console.log(`\nrecorded to ${outDir}`)
}

main().catch(async (error) => {
  console.error(error)
  await disconnect().catch(() => undefined)
  process.exit(1)
})
