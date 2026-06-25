import type { ScraperResult } from '@/lib/types'
import {
  loadPageContent,
  findCountDetailed,
  exactCount,
  extractJsonNumber,
  pickPreciseCount,
} from './_shared'

interface FacebookData {
  followers: number
  likes: number
  page_name: string
}

/**
 * Scrapes a fixed Facebook page permalink for public follower/like counts.
 * `target` is the exact URL stored in social_profiles (falls back to building
 * a URL from a bare page handle for backwards compatibility).
 */
export async function scrapeFacebook(
  target: string
): Promise<ScraperResult<FacebookData>> {
  const scraped_at = new Date().toISOString()
  const url = target.startsWith('http')
    ? target
    : `https://www.facebook.com/${target}`

  try {
    const page = await loadPageContent(url)

    const metaText = `${page.metaDescription} ${page.ogDescription}`

    // Prefer the live body text (exact integer) over the cached/abbreviated
    // meta description so a 1-follower change is captured.
    const followers = pickPreciseCount(
      findCountDetailed(page.bodyText, ['followers', 'people follow this']),
      exactCount(extractJsonNumber(page.html, ['followerCount', 'follower_count'])),
      findCountDetailed(metaText, ['followers', 'people follow this'])
    )

    if (followers === null) {
      throw new Error(
        'Facebook page loaded but follower count not found — login wall or restricted page'
      )
    }

    const likes =
      pickPreciseCount(
        findCountDetailed(page.bodyText, ['likes', 'people like this']),
        exactCount(extractJsonNumber(page.html, ['likeCount', 'like_count'])),
        findCountDetailed(metaText, ['likes', 'people like this'])
      ) ?? 0

    return {
      success: true,
      data: {
        followers,
        likes,
        page_name: page.ogTitle || page.title,
      },
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
