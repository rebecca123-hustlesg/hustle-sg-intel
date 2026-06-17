import type { ScraperResult } from '@/lib/types'

interface YouTubeData {
  subscribers: number
  videos: number
  channel_name: string
}

/**
 * Resolves a channel identifier to a YouTube channel ID.
 * Accepts:
 *   - UC... channel IDs  (used directly)
 *   - @handle            (uses forHandle param)
 *   - c/username         (uses forUsername param)
 *   - bare username      (uses forUsername param)
 */
async function resolveChannelId(
  identifier: string,
  apiKey: string
): Promise<string | null> {
  // Already a channel ID
  if (identifier.startsWith('UC')) {
    return identifier
  }

  // @handle — YouTube Data API supports forHandle
  if (identifier.startsWith('@')) {
    const handle = identifier.slice(1) // strip the @
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`
    const res = await fetch(url)
    const data = await res.json()
    return data?.items?.[0]?.id ?? null
  }

  // c/username or bare username — use forUsername
  const username = identifier.startsWith('c/')
    ? identifier.slice(2)
    : identifier
  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${encodeURIComponent(username)}&key=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()
  return data?.items?.[0]?.id ?? null
}

export async function scrapeYouTube(
  channelIdentifier: string
): Promise<ScraperResult<YouTubeData>> {
  const scraped_at = new Date().toISOString()
  const sourceUrl = channelIdentifier.startsWith('http')
    ? channelIdentifier
    : `https://www.youtube.com/${channelIdentifier}`

  const apiKey = process.env.YOUTUBE_API_KEY

  if (!apiKey) {
    return {
      success: false,
      data: null,
      error: 'YOUTUBE_API_KEY not configured',
      scraped_at,
      source: sourceUrl,
    }
  }

  try {
    // Step 1: resolve identifier → channel ID
    const channelId = await resolveChannelId(channelIdentifier, apiKey)

    if (!channelId) {
      return {
        success: false,
        data: null,
        error: `Could not resolve channel ID for: ${channelIdentifier}`,
        scraped_at,
        source: sourceUrl,
      }
    }

    // Step 2: fetch channel statistics
    const statsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${channelId}&key=${apiKey}`
    const statsRes = await fetch(statsUrl)

    if (!statsRes.ok) {
      throw new Error(`YouTube API error: HTTP ${statsRes.status}`)
    }

    const statsData = await statsRes.json()

    if (statsData.error) {
      throw new Error(`YouTube API error: ${statsData.error.message}`)
    }

    const channel = statsData?.items?.[0]
    if (!channel) {
      return {
        success: false,
        data: null,
        error: `Channel not found for ID: ${channelId}`,
        scraped_at,
        source: sourceUrl,
      }
    }

    const subscribers = parseInt(channel.statistics?.subscriberCount ?? '0', 10)
    const videos = parseInt(channel.statistics?.videoCount ?? '0', 10)
    const channelName = channel.snippet?.title ?? channelIdentifier

    return {
      success: true,
      data: {
        subscribers,
        videos,
        channel_name: channelName,
      },
      error: null,
      scraped_at,
      source: `https://www.youtube.com/channel/${channelId}`,
    }
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      scraped_at,
      source: sourceUrl,
    }
  }
}
