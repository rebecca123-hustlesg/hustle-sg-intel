import { existsSync } from 'fs'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'

/** Resolves the local Chrome/Chromium executable for non-Vercel environments. */
function resolveLocalChrome(): string {
  // Explicit override always wins.
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH
  }

  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    return candidates.find((p) => p && existsSync(p)) ?? candidates[0]
  }

  // Linux (non-Vercel)
  const linuxCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]
  return linuxCandidates.find((p) => existsSync(p)) ?? linuxCandidates[0]
}

// A desktop Chrome UA — social sites (TikTok/LinkedIn) serve their full,
// data-rich page (embedded follower JSON) to a normal desktop browser but
// gate or block obviously-automated clients.
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Anti-automation flag that, combined with the navigator.webdriver patch below,
// is enough to get TikTok's SIGI_STATE JSON and LinkedIn's public meta data.
const STEALTH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,900',
]

/** Launches a browser appropriate for the current environment. */
async function launchBrowser(): Promise<Browser> {
  const isProduction = process.env.VERCEL === '1'

  if (isProduction) {
    return puppeteer.launch({
      args: [...chromium.args, '--disable-blink-features=AutomationControlled'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
  }

  // Local development — use system Chrome/Edge if available
  return puppeteer.launch({
    headless: true,
    executablePath: resolveLocalChrome(),
    args: STEALTH_ARGS,
  })
}

/** @deprecated use {@link withBrowser}. Kept for backward compatibility. */
export async function getBrowser() {
  return launchBrowser()
}

/** Applies UA, headers and the webdriver-hiding patch to a page. */
async function applyStealth(page: Page): Promise<void> {
  await page.setUserAgent(DESKTOP_UA)
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  })
  // Hide the automation signal that TikTok/LinkedIn look for.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
}

// ---------------------------------------------------------------------------
// Shared warm-browser session
// ---------------------------------------------------------------------------
// TikTok and LinkedIn block / strip data from a *cold* headless browser that is
// launched fresh per request. A single browser that is warmed up against each
// domain first (so it carries cookies / a session) and then reused for every
// profile reliably receives the full page with embedded follower JSON.
//
// A scrape batch (e.g. the social ingestion cron) calls openSharedBrowser()
// once, runs all scrapers (withBrowser transparently reuses the session), then
// calls closeSharedBrowser(). When no shared session is open, withBrowser falls
// back to the original launch-per-call behaviour.

let sharedBrowser: Browser | null = null

const WARMUP_URLS = [
  'https://www.youtube.com',
  'https://www.tiktok.com/explore',
  'https://www.linkedin.com',
]

/** Opens (and warms up) a single browser to be reused for a scrape batch. */
export async function openSharedBrowser(): Promise<void> {
  if (sharedBrowser) return
  sharedBrowser = await launchBrowser()

  for (const url of WARMUP_URLS) {
    try {
      const page = await sharedBrowser.newPage()
      await applyStealth(page)
      await page
        .goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        .catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await page.close()
    } catch {
      // Warm-up is best-effort; ignore failures.
    }
  }
}

/** Closes the shared browser opened by {@link openSharedBrowser}. */
export async function closeSharedBrowser(): Promise<void> {
  if (!sharedBrowser) return
  await sharedBrowser.close().catch(() => {})
  sharedBrowser = null
}

/**
 * Runs `fn` with a stealth-configured page. If a shared warm session is open it
 * reuses that browser (only the page is closed afterwards); otherwise it
 * launches and closes a dedicated browser for this single call.
 */
export async function withBrowser<T>(
  fn: (page: Page) => Promise<T>
): Promise<T> {
  if (sharedBrowser) {
    const page = await sharedBrowser.newPage()
    await applyStealth(page)
    try {
      return await fn(page)
    } finally {
      await page.close().catch(() => {})
    }
  }

  const browser = await launchBrowser()
  const page = await browser.newPage()
  await applyStealth(page)
  try {
    return await fn(page)
  } finally {
    await browser.close()
  }
}
