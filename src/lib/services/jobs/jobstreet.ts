import type { ScraperResult } from '@/lib/types'
import { withBrowser } from '@/lib/services/scraper/browser'
import { companyMatches } from '@/lib/services/jobs/employer'
import type { Page } from 'puppeteer-core'

interface JobStreetJob {
  title: string
  department: string | null
  location: string | null
  job_type: string | null
  source: string
  source_url: string | null
  posted_at: string | null
  salary_min: number | null
  salary_max: number | null
  currency: string
  raw_data: Record<string, unknown>
}

// JobStreet (a SEEK network site) is a hydrated SPA behind bot protection: a
// plain `fetch` is served a 403/empty shell. The real listing data is embedded
// as structured JSON in the server-rendered `window.SEEK_REDUX_DATA` blob
// (results.results.jobs[]) and rendered into DOM nodes that carry SEEK's stable
// `data-automation` test hooks. We load the page with the shared stealth
// browser service and read the structured JSON first, falling back to the
// data-automation DOM nodes — never brittle CSS class selectors.

function parseSalaryLabel(label: string | null | undefined): {
  salary_min: number | null
  salary_max: number | null
} {
  if (!label) return { salary_min: null, salary_max: null }
  // Examples: "$3,000 – $5,000 per month", "$25 – $35 per hour", "SGD 60,000".
  const nums = label.match(/[\d][\d,]*/g)
  if (!nums || nums.length === 0) return { salary_min: null, salary_max: null }
  const values = nums
    .map((n) => parseInt(n.replace(/,/g, ''), 10))
    .filter((n) => !isNaN(n))
  if (values.length === 0) return { salary_min: null, salary_max: null }
  const min = values[0]
  const max = values.length > 1 ? values[1] : values[0]
  return { salary_min: min ?? null, salary_max: max ?? null }
}

/** String-aware `{...}` matcher starting at `start` (the opening brace). */
function matchBraces(html: string, start: number): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return html.slice(start, i + 1)
    }
  }
  return null
}

interface ReduxJob {
  id?: string | number
  title?: string
  companyName?: string
  advertiser?: { description?: string }
  salaryLabel?: string
  listingDate?: string
  workTypes?: string[]
  locations?: Array<{ label?: string }>
  classifications?: Array<{ classification?: { description?: string } }>
  employer?: { companyUrl?: string }
}

function mapReduxJob(j: ReduxJob): JobStreetJob | null {
  if (!j || !j.title) return null
  const company = j.companyName || j.advertiser?.description || null
  const { salary_min, salary_max } = parseSalaryLabel(j.salaryLabel)
  return {
    title: j.title,
    department: j.classifications?.[0]?.classification?.description ?? null,
    location: j.locations?.[0]?.label ?? 'Singapore',
    job_type:
      Array.isArray(j.workTypes) && j.workTypes.length ? j.workTypes.join(', ') : null,
    source: 'jobstreet',
    source_url: j.id != null ? `https://sg.jobstreet.com/job/${j.id}` : null,
    posted_at: j.listingDate ?? null,
    salary_min,
    salary_max,
    currency: 'SGD',
    raw_data: {
      id: j.id ?? null,
      title: j.title,
      companyName: company,
      salaryLabel: j.salaryLabel ?? null,
      listingDate: j.listingDate ?? null,
      workTypes: j.workTypes ?? null,
      location: j.locations?.[0]?.label ?? null,
      classification: j.classifications?.[0]?.classification?.description ?? null,
      companyUrl: j.employer?.companyUrl ?? null,
    },
  }
}

/** Extraction result: how many raw postings the page yielded (pre-validation)
 * and the subset whose employer positively matched the competitor. */
interface ExtractResult {
  fetched: number
  matched: JobStreetJob[]
}

/** Primary path: structured jobs from the embedded SEEK_REDUX_DATA JSON. */
function extractFromRedux(html: string, companyName: string): ExtractResult {
  const marker = html.indexOf('SEEK_REDUX_DATA')
  if (marker === -1) return { fetched: 0, matched: [] }
  const start = html.indexOf('{', marker)
  if (start === -1) return { fetched: 0, matched: [] }
  const jsonStr = matchBraces(html, start)
  if (!jsonStr) return { fetched: 0, matched: [] }

  let data: { results?: { results?: { jobs?: ReduxJob[] } } }
  try {
    data = JSON.parse(jsonStr)
  } catch {
    return { fetched: 0, matched: [] }
  }
  const jobs = data?.results?.results?.jobs
  if (!Array.isArray(jobs)) return { fetched: 0, matched: [] }

  const mapped = jobs.map(mapReduxJob).filter((j): j is JobStreetJob => j !== null)
  // Fail closed: only keep postings whose employer positively matches the
  // competitor. If nothing matches, this competitor has no JobStreet jobs —
  // never fall back to the unrelated keyword-search results.
  const matched = mapped.filter((j) =>
    companyMatches(companyName, j.raw_data.companyName as string | null)
  )
  return { fetched: mapped.length, matched }
}

/** Fallback path: SEEK's stable `data-automation` DOM hooks (not CSS classes). */
async function extractFromDom(page: Page, companyName: string): Promise<ExtractResult> {
  const raw = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll('[data-automation="normalJob"], article[data-card-type]')
    )
    return cards
      .map((card) => {
        const titleEl = card.querySelector(
          '[data-automation="jobTitle"]'
        ) as HTMLAnchorElement | null
        const title = titleEl?.textContent?.trim() || ''
        const href =
          titleEl?.getAttribute('href') ||
          (titleEl?.closest('a') as HTMLAnchorElement | null)?.getAttribute('href') ||
          ''
        const company =
          card.querySelector('[data-automation="jobCompany"]')?.textContent?.trim() || ''
        const location =
          card.querySelector('[data-automation="jobLocation"]')?.textContent?.trim() || ''
        const salary =
          card.querySelector('[data-automation="jobSalary"]')?.textContent?.trim() || ''
        const date =
          card.querySelector('[data-automation="jobListingDate"]')?.textContent?.trim() || ''
        const department =
          card.querySelector('[data-automation="jobClassification"]')?.textContent?.trim() ||
          ''
        return { title, href, company, location, salary, date, department }
      })
      .filter((j) => j.title)
  })

  const mapped: JobStreetJob[] = raw.map((j) => {
    const { salary_min, salary_max } = parseSalaryLabel(j.salary)
    const source_url = j.href
      ? j.href.startsWith('http')
        ? j.href
        : `https://sg.jobstreet.com${j.href}`
      : null
    return {
      title: j.title,
      department: j.department || null,
      location: j.location || 'Singapore',
      job_type: null,
      source: 'jobstreet',
      source_url,
      posted_at: null,
      salary_min,
      salary_max,
      currency: 'SGD',
      raw_data: {
        title: j.title,
        companyName: j.company || null,
        location: j.location,
        salaryLabel: j.salary,
        date: j.date,
      },
    }
  })

  // Fail closed: same employer-match rule as the JSON path — no match, no jobs.
  const matched = mapped.filter((j) =>
    companyMatches(companyName, j.raw_data.companyName as string | null)
  )
  return { fetched: mapped.length, matched }
}

// Bounded pagination for the JobStreet keyword search. JobStreet returns only
// one page (~20-30 results) per request, so a single-page scrape silently
// dropped every posting beyond page 1. We now walk pages 1..MAX_PAGES in the
// SAME browser session, reusing the existing extractors and company filter, and
// stop early when a page yields no new usable jobs.
const MAX_PAGES = 5
// Pacing between page navigations to reduce bot-detection risk.
const PAGE_DELAY_MS = 1500

// Some competitors post on JobStreet under a different legal/employer name than
// the display name we track. The alias is used ONLY to build the JobStreet
// search URL — the company filter (companyMatches) still runs against the real
// competitor name, and the UI display name is never affected.
// Keyed by the competitor's display name.
const JOBSTREET_SEARCH_ALIASES: Record<string, string> = {
  'Hustle SG': 'Hustle Institute',
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Stable identity for a scraped job, used only to de-duplicate page overlaps
 * (e.g. an out-of-range page echoing page 1) — NOT the ingestion/read dedup. */
function jobIdentity(job: JobStreetJob): string {
  const id = job.raw_data?.id
  if (id != null && id !== '') return `id:${String(id)}`
  if (job.source_url) return `url:${job.source_url}`
  return `title:${job.title.toLowerCase().trim()}`
}

export async function scrapeJobStreet(
  companyName: string
): Promise<ScraperResult<JobStreetJob[]>> {
  const scraped_at = new Date().toISOString()
  // Alias affects ONLY the search keyword; companyMatches still filters against
  // the real competitor name (companyName), so matching behaviour is unchanged.
  const searchTerm = JOBSTREET_SEARCH_ALIASES[companyName] ?? companyName
  if (searchTerm !== companyName) {
    console.log(
      `[jobstreet] Using search alias "${searchTerm}" for competitor "${companyName}"`
    )
  }
  const baseUrl = `https://sg.jobstreet.com/jobs?keywords=${encodeURIComponent(searchTerm)}`

  try {
    const jobs = await withBrowser(async (page) => {
      const collected: JobStreetJob[] = []
      const seen = new Set<string>()
      let totalFetched = 0
      let totalRejected = 0

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const pageUrl = pageNum === 1 ? baseUrl : `${baseUrl}&page=${pageNum}`

        if (pageNum > 1) await sleep(PAGE_DELAY_MS)

        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        // The listing data is server-rendered, but wait briefly for the job
        // nodes so the DOM fallback is reliable if the JSON shape ever changes.
        await page
          .waitForSelector('[data-automation="jobTitle"]', { timeout: 15_000 })
          .catch(() => {})

        const html = await page.content()
        const fromJson = extractFromRedux(html, companyName)
        // Only fall back to the DOM when the JSON path yielded NO raw postings
        // (structure changed) — not when postings existed but were all rejected.
        const pageResult =
          fromJson.fetched > 0 ? fromJson : await extractFromDom(page, companyName)
        const pageJobs = pageResult.matched

        totalFetched += pageResult.fetched
        totalRejected += pageResult.fetched - pageResult.matched.length

        // No raw postings on this page → we've run past the last page.
        if (pageResult.fetched === 0) {
          break
        }

        let kept = 0
        for (const job of pageJobs) {
          const key = jobIdentity(job)
          if (seen.has(key)) continue
          seen.add(key)
          collected.push(job)
          kept++
        }

        // Nothing on this page survived validation → this competitor has no
        // JobStreet jobs on this page; stop rather than paging unrelated noise.
        if (pageJobs.length === 0) {
          break
        }

        // Every validated job was already seen (e.g. an out-of-range page
        // echoing an earlier page) → no forward progress, stop.
        if (kept === 0) {
          break
        }
      }

      console.log(
        `[JobStreet]\nCompetitor: ${companyName}\n\n` +
          `Fetched: ${totalFetched}\nValidated: ${collected.length}\nRejected: ${totalRejected}` +
          (totalRejected > 0 ? `\n\nReason:\nEmployer mismatch` : '')
      )

      return collected
    })

    return {
      success: true,
      data: jobs,
      error: null,
      scraped_at,
      source: baseUrl,
    }
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      scraped_at,
      source: baseUrl,
    }
  }
}
