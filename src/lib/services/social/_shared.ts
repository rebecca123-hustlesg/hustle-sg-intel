/**
 * Shared helpers for fixed-permalink social profile scraping.
 *
 * These scrapers visit the EXACT profile URL stored in `social_profiles`
 * (the 10 fixed competitors) using the existing Puppeteer browser service,
 * then extract publicly-visible follower/subscriber counts. No fabrication:
 * if a count cannot be found the caller returns `unavailable` cleanly.
 */
import { withBrowser } from '@/lib/services/scraper/browser'

export interface PageContent {
  /** Full rendered HTML (page.content()) */
  html: string
  /** <title> text */
  title: string
  /** meta[name=description] (falls back to og:description) */
  metaDescription: string
  /** meta[property=og:title] */
  ogTitle: string
  /** meta[property=og:description] */
  ogDescription: string
  /** document.body.innerText, capped */
  bodyText: string
}

/**
 * Loads the exact URL in a real (headless) browser, waits for the page to
 * settle, and returns the rendered HTML plus the most useful text signals.
 */
export async function loadPageContent(
  url: string,
  opts: { waitMs?: number; timeoutMs?: number } = {}
): Promise<PageContent> {
  const { waitMs = 3500, timeoutMs = 20_000 } = opts

  return withBrowser(async (page) => {
    page.setDefaultNavigationTimeout(timeoutMs)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    } catch (err) {
      // Sites with persistent / streaming connections (notably TikTok) keep the
      // navigation "pending" past the timeout even though the DOM and the
      // embedded JSON are already available. Swallow pure timeouts and read
      // whatever loaded; re-throw anything else (DNS failure, crash, etc.).
      const msg = err instanceof Error ? err.message : String(err)
      if (!/timeout/i.test(msg)) throw err
    }
    // Give client-rendered content a moment to populate.
    await new Promise((resolve) => setTimeout(resolve, waitMs))

    const html = await page.content()
    const title = await page.title()

    const meta = await page.evaluate(() => {
      const attr = (sel: string) =>
        (document.querySelector(sel) as HTMLMetaElement | null)?.content || ''
      return {
        metaDescription:
          attr('meta[name="description"]') ||
          attr('meta[property="og:description"]'),
        ogTitle: attr('meta[property="og:title"]'),
        ogDescription: attr('meta[property="og:description"]'),
        bodyText: (document.body?.innerText || '').slice(0, 20_000),
      }
    })

    return { html, title, ...meta }
  })
}

/**
 * Parses a human-readable count into an integer.
 *   "1.2K"   -> 1200
 *   "15,891" -> 15891
 *   "2M"     -> 2000000
 *   "1.5B"   -> 1500000000
 *   12345    -> 12345
 * Returns null when nothing numeric can be parsed.
 */
export function parseCount(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.round(raw) : null
  }

  const s = raw.trim().toLowerCase().replace(/,/g, '')
  if (!s) return null

  const m = s.match(/^([\d]+(?:\.\d+)?)\s*([kmb])?/)
  if (!m) return null

  const num = parseFloat(m[1])
  if (!Number.isFinite(num)) return null

  const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1
  return Math.round(num * mult)
}

/**
 * Context-aware extraction: finds a count value adjacent to a keyword such as
 * "followers", "subscribers" or "likes". Looks for the number both BEFORE the
 * keyword ("1.2K followers") and AFTER it ("followers 1,234").
 */
export function findCountByKeyword(
  text: string,
  keywords: string[]
): number | null {
  if (!text) return null

  for (const kw of keywords) {
    // number BEFORE keyword: "30.4K followers"
    const before = new RegExp(
      `([\\d][\\d.,]*\\s*[kmb]?)\\s*${kw}`,
      'i'
    ).exec(text)
    if (before) {
      const v = parseCount(before[1])
      if (v !== null) return v
    }

    // number AFTER keyword: "followers: 12,345"
    const after = new RegExp(
      `${kw}[^\\d]{0,15}([\\d][\\d.,]*\\s*[kmb]?)`,
      'i'
    ).exec(text)
    if (after) {
      const v = parseCount(after[1])
      if (v !== null) return v
    }
  }

  return null
}

/**
 * Extracts a numeric value from embedded JSON / script data, e.g.
 * `"followerCount":12345` or `"edge_followed_by":{"count":12345}`.
 */
export function extractJsonNumber(
  html: string,
  keys: string[]
): number | null {
  if (!html) return null

  for (const key of keys) {
    // "key": 12345  |  "key": "12345"
    const direct = new RegExp(`"${key}"\\s*:\\s*"?(\\d+)"?`, 'i').exec(html)
    if (direct) {
      const v = parseInt(direct[1], 10)
      if (Number.isFinite(v) && v > 0) return v
    }

    // "key":{"count":12345}
    const nested = new RegExp(
      `"${key}"\\s*:\\s*\\{[^}]*?"count"\\s*:\\s*(\\d+)`,
      'i'
    ).exec(html)
    if (nested) {
      const v = parseInt(nested[1], 10)
      if (Number.isFinite(v) && v > 0) return v
    }
  }

  return null
}

/**
 * A parsed count together with whether it was an EXACT raw integer.
 * `exact === false` means the source only gave an abbreviated value
 * ("31K", "1.2M") which loses precision and should be used last.
 */
export interface CountResult {
  value: number
  exact: boolean
}

function toCountResult(token: string): CountResult | null {
  const trimmed = token.trim()
  const value = parseCount(trimmed)
  if (value === null) return null
  // Abbreviated tokens carry a K/M/B suffix → not precise to the unit.
  return { value, exact: !/[kmb]/i.test(trimmed) }
}

/**
 * Like {@link findCountByKeyword} but also reports whether the matched token
 * was an exact raw integer ("7,024") or an abbreviated value ("31K").
 */
export function findCountDetailed(
  text: string,
  keywords: string[]
): CountResult | null {
  if (!text) return null

  for (const kw of keywords) {
    const before = new RegExp(
      `([\\d][\\d.,]*\\s*[kmb]?)\\s*${kw}`,
      'i'
    ).exec(text)
    if (before) {
      const r = toCountResult(before[1])
      if (r) return r
    }

    const after = new RegExp(
      `${kw}[^\\d]{0,15}([\\d][\\d.,]*\\s*[kmb]?)`,
      'i'
    ).exec(text)
    if (after) {
      const r = toCountResult(after[1])
      if (r) return r
    }
  }

  return null
}

/** Wraps a known-exact integer (e.g. from embedded JSON) as a CountResult. */
export function exactCount(value: number | null | undefined): CountResult | null {
  return value === null || value === undefined ? null : { value, exact: true }
}

/**
 * Picks the MOST PRECISE count from candidates given in priority order.
 *
 * Precision rules:
 *  - An exact (raw-integer) value always beats an abbreviated one.
 *  - Among candidates of equal precision the earliest one wins, so callers
 *    should pass the most live/current source first (e.g. the rendered body
 *    text) and stale/cached sources last (e.g. the og:description meta tag).
 *
 * This guarantees raw integers are preserved and a 1-follower change is
 * captured whenever any source exposes the exact value.
 */
export function pickPreciseCount(
  ...candidates: (CountResult | null)[]
): number | null {
  const present = candidates.filter((c): c is CountResult => c !== null)
  if (present.length === 0) return null
  return (present.find((c) => c.exact) ?? present[0]).value
}

/**
 * Like {@link pickPreciseCount} but returns the full {@link CountResult} so the
 * caller can tell whether the value is an exact raw integer. Used by scrapers
 * that retry the page load until an exact (non-abbreviated) value is found.
 */
export function pickPreciseDetailed(
  ...candidates: (CountResult | null)[]
): CountResult | null {
  const present = candidates.filter((c): c is CountResult => c !== null)
  if (present.length === 0) return null
  return present.find((c) => c.exact) ?? present[0]
}
