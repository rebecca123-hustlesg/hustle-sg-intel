import type { ScraperResult } from '@/lib/types'
import {
  loadPageContent,
  findCountDetailed,
  exactCount,
  extractJsonNumber,
  pickPreciseCount,
  pickPreciseDetailed,
} from './_shared'

interface InstagramData {
  followers: number
  following: number
  posts_count: number
}

/**
 * Scrapes a fixed Instagram profile permalink for public follower counts.
 * `target` is the exact URL stored in social_profiles (falls back to building
 * a URL from a bare handle for backwards compatibility).
 */
export async function scrapeInstagram(
  target: string
): Promise<ScraperResult<InstagramData>> {
  const scraped_at = new Date().toISOString()
  const url = target.startsWith('http')
    ? target
    : `https://www.instagram.com/${target.replace('@', '')}/`

  try {
    // Instagram serves inconsistent logged-out page variants: some embed the
    // EXACT follower integer ("follower_count":13902), others only expose an
    // abbreviated value ("13.9K"/"14K") in the body/meta. For daily growth
    // tracking we need the exact integer, so retry the load a few times and
    // keep going until an exact value appears — only settling for an
    // abbreviated value if every attempt failed to expose the precise one.
    let best: {
      followers: number
      following: number
      posts_count: number
    } | null = null

    for (let attempt = 0; attempt < 4; attempt++) {
      const page = await loadPageContent(url)
      const metaText = `${page.metaDescription} ${page.ogDescription}`

      // Embedded JSON is the authoritative exact source → try it first.
      const followersResult = pickPreciseDetailed(
        exactCount(
          extractJsonNumber(page.html, [
            'follower_count',
            'edge_followed_by',
            'followerCount',
          ])
        ),
        findCountDetailed(page.bodyText, ['followers']),
        findCountDetailed(metaText, ['followers'])
      )

      if (followersResult === null) {
        // Nothing at all this attempt — try again.
        continue
      }

      const following =
        pickPreciseCount(
          exactCount(extractJsonNumber(page.html, ['following_count', 'edge_follow'])),
          findCountDetailed(page.bodyText, ['following']),
          findCountDetailed(metaText, ['following'])
        ) ?? 0

      const posts_count =
        pickPreciseCount(
          exactCount(
            extractJsonNumber(page.html, ['media_count', 'edge_owner_to_timeline_media'])
          ),
          findCountDetailed(page.bodyText, ['posts']),
          findCountDetailed(metaText, ['posts'])
        ) ?? 0

      // Prefer an exact result; otherwise hold the abbreviated one as a
      // fallback and keep retrying for an exact value.
      if (best === null || followersResult.exact) {
        best = { followers: followersResult.value, following, posts_count }
      }
      if (followersResult.exact) break

      // Brief pause so Instagram serves a fresh (often JSON-bearing) variant.
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }

    if (best === null) {
      throw new Error(
        'Instagram page loaded but follower count not found — login wall or layout change'
      )
    }

    return {
      success: true,
      data: best,
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
