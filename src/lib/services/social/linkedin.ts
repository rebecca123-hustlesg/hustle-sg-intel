import type { ScraperResult } from '@/lib/types'
import {
  loadPageContent,
  findCountDetailed,
  exactCount,
  extractJsonNumber,
  pickPreciseCount,
} from './_shared'

interface LinkedInData {
  followers: number
  employees: number
  company_name: string
}

/**
 * Scrapes a fixed LinkedIn company/school permalink for public follower counts.
 * `target` is the exact URL stored in social_profiles (falls back to building
 * a URL from a stored company path for backwards compatibility).
 */
export async function scrapeLinkedIn(
  target: string
): Promise<ScraperResult<LinkedInData>> {
  const scraped_at = new Date().toISOString()
  const url = target.startsWith('http')
    ? target
    : `https://www.linkedin.com/${target}`

  try {
    const page = await loadPageContent(url)

    const metaText = `${page.metaDescription} ${page.ogDescription}`

    // Prefer an exact integer from any source over an abbreviated one.
    const followers = pickPreciseCount(
      findCountDetailed(page.bodyText, ['followers']),
      exactCount(extractJsonNumber(page.html, ['followerCount', 'followingInfoCount'])),
      findCountDetailed(metaText, ['followers'])
    )

    if (followers === null) {
      throw new Error(
        'LinkedIn page loaded but follower count not accessible — auth wall or restricted data'
      )
    }

    const employees =
      pickPreciseCount(
        findCountDetailed(page.bodyText, ['employees']),
        exactCount(extractJsonNumber(page.html, ['staffCount'])),
        findCountDetailed(metaText, ['employees'])
      ) ?? 0

    const company_name = (page.ogTitle || page.title)
      .replace(' | LinkedIn', '')
      .trim()

    return {
      success: true,
      data: { followers, employees, company_name },
      error: null,
      scraped_at,
      source: url,
    }
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      scraped_at,
      source: url,
    }
  }
}
