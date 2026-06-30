/**
 * Shared social-intelligence query layer.
 *
 * This is a LITERAL extraction of the `social_snapshots` aggregation that already
 * lived inside `app/social-intelligence/page.tsx`. The exact selection rules
 * (latest snapshot per competitor+platform, previous snapshot for 24h growth,
 * total audience = sum of available platforms, nulls-last ranking) are unchanged.
 *
 * Both the Social Intelligence page and the Dashboard import from here so they
 * display identical numbers with no duplicated business logic.
 */

import { createClient } from '@/lib/supabase/server'

export interface SnapshotRow {
  competitor_id: string
  platform: string
  follower_count: number | null
  total_posts: number | null
  snapshot_date: string
}

export interface CompetitorRow {
  id: string
  name: string
  color: string
  is_hustle: boolean
  tier?: string | null
}

export interface FollowerMaps {
  /** Latest YouTube snapshot per competitor (subscribers + video count). */
  ytMap: Map<string, { subscribers: number | null; videos: number | null }>
  /** Latest follower snapshot per `${competitorId}:${platform}`. */
  followerMap: Map<string, number | null>
  /** Previous (prior-day) follower snapshot per `${competitorId}:${platform}`. */
  prevFollowerMap: Map<string, number | null>
}

/**
 * Build the latest/previous follower maps from a snapshot list.
 * `snapshots` MUST be ordered by snapshot_date DESC (as the Social page queries
 * them), so the first row seen per key is the most recent verified value.
 */
export function buildFollowerMaps(snapshots: SnapshotRow[]): FollowerMaps {
  // ── YouTube data (only verified live data) ──
  const ytMap = new Map<string, { subscribers: number | null; videos: number | null }>()
  const seenYT = new Set<string>()
  for (const s of snapshots) {
    if (s.platform !== 'youtube' || seenYT.has(s.competitor_id)) continue
    seenYT.add(s.competitor_id)
    ytMap.set(s.competitor_id, {
      subscribers: s.follower_count,
      videos: s.total_posts,
    })
  }

  // ── Latest follower snapshot per competitor + platform ──
  const followerMap = new Map<string, number | null>()
  const seenFollowerKey = new Set<string>()
  for (const s of snapshots) {
    const key = `${s.competitor_id}:${s.platform}`
    if (seenFollowerKey.has(key)) continue
    seenFollowerKey.add(key)
    followerMap.set(key, s.follower_count)
  }

  // ── Previous follower snapshot per competitor + platform ──
  const prevFollowerMap = new Map<string, number | null>()
  const seenLatestKey = new Set<string>()
  for (const s of snapshots) {
    const key = `${s.competitor_id}:${s.platform}`
    if (!seenLatestKey.has(key)) { seenLatestKey.add(key); continue }
    if (!prevFollowerMap.has(key)) prevFollowerMap.set(key, s.follower_count)
  }

  return { ytMap, followerMap, prevFollowerMap }
}

export interface SocialRankingRow {
  competitor_id: string
  competitor_name: string
  competitor_color: string
  is_hustle: boolean
  tier: string | null
  instagram_followers: number | null
  facebook_followers: number | null
  linkedin_followers: number | null
  tiktok_followers: number | null
  youtube_followers: number | null
  /** Sum of every platform with a real snapshot (0 when none available). */
  total_followers: number
  /** 1-based rank by total audience; competitors with no data sort last. */
  rank: number
}

/**
 * Compute the audience ranking from competitors + snapshots, using the same
 * total-audience rule and nulls-last ordering as the Social Intelligence page.
 */
export function buildSocialRanking(
  competitors: CompetitorRow[],
  snapshots: SnapshotRow[]
): SocialRankingRow[] {
  const { ytMap, followerMap } = buildFollowerMaps(snapshots)

  const rows = competitors.map((c) => {
    const ig = followerMap.get(`${c.id}:instagram`) ?? null
    const fb = followerMap.get(`${c.id}:facebook`) ?? null
    const li = followerMap.get(`${c.id}:linkedin`) ?? null
    const tt = followerMap.get(`${c.id}:tiktok`) ?? null
    const yt = ytMap.get(c.id)?.subscribers ?? null

    // Total tracked audience = sum of every platform with a real snapshot.
    const parts = [yt, ig, fb, li, tt].filter((v): v is number => v !== null)
    const hasData = parts.length > 0
    const total = hasData ? parts.reduce((a, b) => a + b, 0) : 0

    return {
      competitor_id: c.id,
      competitor_name: c.name,
      competitor_color: c.color,
      is_hustle: c.is_hustle,
      tier: c.tier ?? null,
      instagram_followers: ig,
      facebook_followers: fb,
      linkedin_followers: li,
      tiktok_followers: tt,
      youtube_followers: yt,
      total_followers: total,
      hasData,
    }
  })

  // Same comparator as the Social page audience board (nulls/no-data last).
  rows.sort((a, b) => {
    if (a.hasData && b.hasData) return b.total_followers - a.total_followers
    if (a.hasData) return -1
    if (b.hasData) return 1
    return 0
  })

  return rows.map(({ hasData: _hasData, ...r }, i) => ({ ...r, rank: i + 1 }))
}

/** Dashboard convenience: fetch competitors + snapshots and return the ranking. */
export async function getSocialRanking(): Promise<SocialRankingRow[]> {
  const supabase = await createClient()
  const [compRes, snapRes] = await Promise.all([
    supabase
      .from('competitors')
      .select('id,name,color,is_hustle,tier')
      .eq('active', true),
    supabase
      .from('social_snapshots')
      .select('competitor_id,platform,follower_count,total_posts,snapshot_date')
      .order('snapshot_date', { ascending: false }),
  ])
  return buildSocialRanking((compRes.data ?? []) as CompetitorRow[], (snapRes.data ?? []) as SnapshotRow[])
}
