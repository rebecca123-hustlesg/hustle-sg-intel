/**
 * Shared hiring-intelligence query layer.
 *
 * LITERAL extraction of the active-jobs read logic from
 * `app/hiring-intelligence/page.tsx`: the same title normalization, non-job
 * filtering, and read-time deduplication (competitor_id + normalized title +
 * source, keeping the most recent row). Both the Hiring page and the Dashboard
 * import from here so the "Active job postings" count is identical.
 */

import { createClient } from '@/lib/supabase/server'

// Collapse duplicate postings that accumulate across daily scrape runs.
// A logical job is identified by competitor_id + normalized(title) + source.
export function normalizeJobTitle(title: string | null): string {
  return (title ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Career-page scraping sometimes captures benefit/perk/marketing lines instead
// of real roles. These patterns (matched against the normalized title) drop
// those non-job entries at read time only — no data is deleted.
const NON_JOB_PATTERNS: RegExp[] = [
  /\bbonus(es)?\b/,
  /\bbenefits?\b/,
  /\bperks?\b/,
  /\bdental\b/,
  /annual leave/,
  /flexi[\s-]?cash/,
  /work arrangement/,
  /nurturing environment/,
  /career growth/,
  /growth opportunit/,
  /from top companies/,
  /projected to reach/,
  /market is projected/,
  /\btrillion\b/,
]

export function isRealJob(title: string | null): boolean {
  const t = normalizeJobTitle(title)
  if (!t) return false
  return !NON_JOB_PATTERNS.some((re) => re.test(t))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ActiveJobsResult<T = any> {
  jobs: T[]
  competitors: T[]
  lastUpdated: string | null
}

/**
 * Fetch active job postings, then apply the canonical non-job filter and
 * read-time deduplication. Returns the deduped jobs, the active competitors,
 * and the most-recent scraped_at timestamp.
 */
export async function getActiveJobs(): Promise<ActiveJobsResult> {
  const supabase = await createClient()

  const [jobsRes, competitorsRes] = await Promise.all([
    supabase
      .from('job_postings')
      .select(`
        *,
        competitors(id, name, slug, color, is_hustle, tier)
      `)
      .eq('is_active', true)
      .order('scraped_at', { ascending: false })
      .limit(1000),
    supabase.from('competitors').select('id, name, color, is_hustle, tier').eq('active', true),
  ])

  const rawJobs = jobsRes.data ?? []
  const competitors = competitorsRes.data ?? []

  // Read-time deduplication: rows are ordered by scraped_at DESC, so the first
  // occurrence of each key is the most recent — keep it, drop the rest.
  // Non-job (benefit/perk/marketing) entries are filtered out at the same time.
  const seenJobKey = new Set<string>()
  const jobs = rawJobs.filter((job) => {
    if (!isRealJob(job.title)) return false
    const key = `${job.competitor_id}|${normalizeJobTitle(job.title)}|${job.source}`
    if (seenJobKey.has(key)) return false
    seenJobKey.add(key)
    return true
  })

  const lastUpdated = jobs[0]?.scraped_at ?? null

  return { jobs, competitors, lastUpdated }
}
