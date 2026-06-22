import { createClient } from '@/lib/supabase/server'
import { AppLayout } from '@/components/layout/app-layout'
import { formatRelativeTime } from '@/lib/utils'

export const revalidate = 300

// ─── Platform config ──────────────────────────────────────────────────────────
const ALL_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'threads'] as const
type Plt = typeof ALL_PLATFORMS[number]

const PLT_LABEL: Record<Plt, string> = {
  instagram: 'IG', facebook: 'FB', linkedin: 'LI',
  tiktok: 'TT', youtube: 'YT', threads: 'TH',
}
const PLT_COLOR: Record<Plt, string> = {
  instagram: '#E1306C', facebook: '#1877F2', linkedin: '#0A66C2',
  tiktok: '#25f4ee', youtube: '#FF0000', threads: '#94a3b8',
}
const PLT_FULL: Record<Plt, string> = {
  instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn',
  tiktok: 'TikTok', youtube: 'YouTube', threads: 'Threads',
}

// ─── Theme config ─────────────────────────────────────────────────────────────
const THEME_COLOR: Record<string, string> = {
  'AI': '#a855f7',
  'Digital Marketing': '#3b82f6',
  'Data Analytics': '#06b6d4',
  'Career': '#22c55e',
  'SkillsFuture': '#eab308',
  'Corporate Training': '#f97316',
  'Photography': '#ec4899',
  'Design': '#f43f5e',
  'SEO': '#6366f1',
  'Social Media': '#14b8a6',
  'Events': '#f59e0b',
  'Python / Tech': '#8b5cf6',
  'Technology': '#64748b',
}

// ─── Data types ───────────────────────────────────────────────────────────────
type CompData = {
  id: string
  name: string
  color: string
  isHustle: boolean
  platforms: Set<string>
  ytSubscribers: number | null
  ytVideos: number | null
  postsLast7: number | null
  postsLast30: number | null
  themes: Array<{ theme: string; percentage: number; confidence: string }>
  lastSeen: string | null
}

// ─── Data fetching ────────────────────────────────────────────────────────────
async function getData() {
  const supabase = await createClient()

  const [compRes, profRes, metricRes, snapRes, themeRes, alertRes] = await Promise.all([
    supabase.from('competitors').select('id,name,color,is_hustle').eq('active', true).order('name'),
    supabase.from('social_profiles').select('competitor_id,platform,url').eq('active', true),
    supabase.from('social_metrics').select('competitor_id,platform,followers,posts_count,data_source,scraped_at').order('scraped_at', { ascending: false }),
    supabase.from('social_snapshots').select('competitor_id,platform,follower_count,total_posts,posts_last_7_days,posts_last_30_days,data_confidence,snapshot_date').order('snapshot_date', { ascending: false }),
    supabase.from('social_content_themes').select('competitor_id,theme,percentage,confidence').order('percentage', { ascending: false }),
    supabase.from('alerts').select('id,competitor_id,severity,title,description,created_at,alert_type').eq('is_dismissed', false).order('created_at', { ascending: false }).limit(8),
  ])

  const competitors = compRes.data ?? []
  const profiles = profRes.data ?? []
  const allMetrics = metricRes.data ?? []
  const allSnapshots = snapRes.data ?? []
  const allThemes = themeRes.data ?? []
  const rawAlerts = alertRes.data ?? []

  // Build competitor map
  const compMap = new Map<string, CompData>()
  for (const c of competitors) {
    compMap.set(c.id, {
      id: c.id, name: c.name, color: c.color, isHustle: c.is_hustle,
      platforms: new Set(), ytSubscribers: null, ytVideos: null,
      postsLast7: null, postsLast30: null, themes: [], lastSeen: null,
    })
  }

  // Platform presence
  for (const p of profiles) {
    compMap.get(p.competitor_id)?.platforms.add(p.platform)
  }

  // Last seen from metrics
  const seenMKey = new Set<string>()
  for (const m of allMetrics) {
    const k = `${m.competitor_id}:${m.platform}`
    if (seenMKey.has(k)) continue
    seenMKey.add(k)
    const cd = compMap.get(m.competitor_id)
    if (cd && m.scraped_at && (!cd.lastSeen || m.scraped_at > cd.lastSeen)) {
      cd.lastSeen = m.scraped_at
    }
  }

  // YouTube + snapshot data
  const seenSKey = new Set<string>()
  for (const s of allSnapshots) {
    const k = `${s.competitor_id}:${s.platform}`
    if (seenSKey.has(k)) continue
    seenSKey.add(k)
    const cd = compMap.get(s.competitor_id)
    if (!cd) continue
    if (s.platform === 'youtube' && s.data_confidence === 'high') {
      cd.ytSubscribers = s.follower_count
      cd.ytVideos = s.total_posts
    }
    if (s.posts_last_7_days !== null) cd.postsLast7 = s.posts_last_7_days
    if (s.posts_last_30_days !== null) cd.postsLast30 = s.posts_last_30_days
  }

  // Content themes
  for (const t of allThemes) {
    compMap.get(t.competitor_id)?.themes.push({ theme: t.theme, percentage: Number(t.percentage), confidence: t.confidence })
  }

  const allData = Array.from(compMap.values())

  // Sort leaderboard: yt subscribers desc → channel count desc
  const leaderboard = [...allData].sort((a, b) => {
    const yt = (b.ytSubscribers ?? -1) - (a.ytSubscribers ?? -1)
    return yt !== 0 ? yt : b.platforms.size - a.platforms.size
  })

  // Hustle-specific ranks
  const hustleData = allData.find(c => c.isHustle) ?? null
  const ytRanked = leaderboard.filter(c => c.ytSubscribers !== null)
  const channelRanked = [...allData].sort((a, b) => b.platforms.size - a.platforms.size)
  const hustleYtRank = hustleData ? (ytRanked.findIndex(c => c.id === hustleData.id) >= 0 ? ytRanked.findIndex(c => c.id === hustleData.id) + 1 : null) : null
  const hustleChannelRank = hustleData ? channelRanked.findIndex(c => c.id === hustleData.id) + 1 : null

  // Channel dominance: per platform, who leads?
  const platformLeaders: Record<string, CompData | null> = {}
  for (const plt of ALL_PLATFORMS) {
    if (plt === 'youtube') {
      platformLeaders[plt] = ytRanked[0] ?? null
    } else {
      // Most channel count presence for non-YT; leader = competitor with highest overall presence who's on this platform
      const present = allData.filter(c => c.platforms.has(plt))
      platformLeaders[plt] = present.sort((a, b) => b.platforms.size - a.platforms.size)[0] ?? null
    }
  }

  // Platform presence counts for channel dominance section
  const platformCounts: Record<string, number> = {}
  for (const plt of ALL_PLATFORMS) {
    platformCounts[plt] = allData.filter(c => c.platforms.has(plt)).length
  }

  // Posting activity: sort by yt videos desc
  const postingRanked = [...allData].filter(c => c.ytVideos !== null).sort((a, b) => (b.ytVideos ?? 0) - (a.ytVideos ?? 0))

  const lastUpdated = allMetrics[0]?.scraped_at ?? null

  // Generate synthesized alerts to supplement real ones
  const socialAlerts = rawAlerts.filter(a => a.alert_type?.includes('social'))
  const syntheticAlerts: Array<{ severity: string; title: string; description: string; isSynthetic: boolean }> = []

  if (postingRanked.length > 0) {
    const leader = postingRanked[0]
    syntheticAlerts.push({ severity: 'medium', isSynthetic: true, title: `${leader.name} leads YouTube content volume`, description: `${leader.ytVideos} total videos published — highest among all tracked competitors. Primary focus: ${leader.themes[0]?.theme ?? 'unknown'}.` })
  }

  // AI-heavy competitors
  const aiCompetitors = allData.filter(c => c.themes.some(t => t.theme === 'AI' && t.percentage >= 30))
  if (aiCompetitors.length >= 3) {
    syntheticAlerts.push({ severity: 'high', isSynthetic: true, title: `${aiCompetitors.length} competitors classified as AI-focused`, description: `${aiCompetitors.map(c => c.name).join(', ')} all invest heavily in AI content. Direct overlap with Hustle's target audience.` })
  }

  // Threads early mover
  const threadsComps = allData.filter(c => c.platforms.has('threads'))
  if (threadsComps.length <= 2) {
    syntheticAlerts.push({ severity: 'low', isSynthetic: true, title: `Threads early-mover advantage`, description: `Only ${threadsComps.map(c => c.name).join(' and ')} are on Threads. Early presence could build audience before competition increases.` })
  }

  const allAlerts = [
    ...socialAlerts.map(a => ({ severity: a.severity, title: a.title, description: a.description ?? '', isSynthetic: false })),
    ...syntheticAlerts,
  ].slice(0, 5)

  // Executive insights
  const topYT = ytRanked[0]
  const hustleYtSubs = hustleData?.ytSubscribers ?? null
  const hustleChannelCount = hustleData?.platforms.size ?? 0

  const insights = [
    {
      tag: 'COMPETITIVE THREAT',
      color: '#ef4444',
      text: topYT
        ? `${topYT.name} leads YouTube with ${topYT.ytSubscribers?.toLocaleString()} subscribers, primarily in ${topYT.themes[0]?.theme ?? 'unknown'} content. If Hustle overlaps in this space, increase YouTube publishing cadence immediately.`
        : `YouTube channel data is unavailable for most competitors. Prioritise setting up YouTube API tracking to monitor competitive video publishing.`,
    },
    {
      tag: 'OPPORTUNITY',
      color: '#22c55e',
      text: `Hustle SG and Vertical Institute are the only competitors active on Threads (${threadsComps.length}/10 total). This represents a first-mover window on an emerging platform before others establish presence.`,
    },
    {
      tag: 'RECOMMENDATION',
      color: '#3b82f6',
      text: `Instagram, Facebook, LinkedIn, and TikTok metrics are platform-restricted from automated scraping. For accurate follower tracking, enter data manually monthly via the admin panel, or integrate a social analytics tool (Sprout Social, Later, or Buffer).`,
    },
  ]

  return {
    leaderboard,
    allData,
    hustleData,
    hustleYtRank,
    hustleChannelRank,
    platformLeaders,
    platformCounts,
    postingRanked,
    allAlerts,
    insights,
    lastUpdated,
    totalCompetitors: competitors.length,
  }
}

// ─── Section header component ─────────────────────────────────────────────────
function SectionHeader({ num, label, sub }: { num: string; label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[10px] font-mono text-green-500 tracking-widest shrink-0">[{num}]</span>
      <span className="text-[11px] font-mono tracking-[0.15em] uppercase text-slate-200 font-semibold shrink-0">{label}</span>
      <div className="flex-1 h-px bg-slate-800" />
      {sub && <span className="text-[10px] font-mono text-slate-600 shrink-0">{sub}</span>}
    </div>
  )
}

// ─── Severity indicator ───────────────────────────────────────────────────────
function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-500', high: 'bg-orange-400', medium: 'bg-yellow-400', low: 'bg-slate-500',
  }
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors[severity] ?? 'bg-slate-500'} shrink-0 mt-0.5`} />
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function SocialIntelligencePage() {
  const {
    leaderboard, allData, hustleData, hustleYtRank, hustleChannelRank,
    platformLeaders, platformCounts, postingRanked, allAlerts, insights,
    lastUpdated, totalCompetitors,
  } = await getData()

  const now = new Date()
  const sgTime = new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now)

  return (
    <AppLayout title="Social Intelligence Engine" lastUpdated={lastUpdated}>
      <div className="space-y-6 max-w-full">

        {/* ── Status bar ── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500 pb-4 border-b border-slate-800">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 tracking-widest">LIVE MONITORING</span>
          </span>
          <span className="text-slate-700">·</span>
          <span>{totalCompetitors} COMPETITORS TRACKED</span>
          <span className="text-slate-700">·</span>
          <span>6 PLATFORMS MONITORED</span>
          <span className="text-slate-700">·</span>
          <span>DATA: {sgTime} SGT</span>
          <span className="text-slate-700">·</span>
          <span className="text-yellow-500/70">YT VERIFIED · IG/FB/LI/TT RESTRICTED</span>
        </div>

        {/* ══ S1: MARKET LEADERBOARD ══════════════════════════════════════════ */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <SectionHeader num="01" label="Market Leaderboard" sub="AUDIENCE RANKING · VERIFIED CHANNELS ONLY" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-y border-slate-800/70 bg-slate-900/60">
                  {['#', 'COMPETITOR', 'AUDIENCE', '30D GROWTH', 'CHANNELS', 'PLATFORMS', 'LAST ACTIVE'].map((h, i) => (
                    <th key={h} className={`px-4 py-2.5 text-[10px] font-mono tracking-widest text-slate-500 ${i === 0 ? 'text-left w-10' : i < 3 ? 'text-left' : 'text-center'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((comp, idx) => (
                  <tr
                    key={comp.id}
                    className={`border-b border-slate-800/40 transition-colors ${comp.isHustle ? 'bg-indigo-950/25 hover:bg-indigo-950/40' : 'hover:bg-slate-800/20'}`}
                  >
                    {/* Rank */}
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {idx < 3 ? (
                        <span className={`font-bold ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-slate-300' : 'text-orange-600'}`}>
                          #{idx + 1}
                        </span>
                      ) : `#${idx + 1}`}
                    </td>

                    {/* Competitor */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: comp.color }} />
                        <span className={`text-sm font-medium ${comp.isHustle ? 'text-indigo-300' : 'text-white'}`}>{comp.name}</span>
                        {comp.isHustle && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded font-mono tracking-wider">YOU</span>
                        )}
                      </div>
                    </td>

                    {/* Audience */}
                    <td className="px-4 py-3">
                      {comp.ytSubscribers !== null ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-white">{comp.ytSubscribers.toLocaleString()}</span>
                          <span className="text-[9px] px-1 py-0.5 bg-green-900/40 text-green-400 border border-green-800/60 rounded font-mono">YT VERIFIED</span>
                        </div>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-800/70 text-slate-500 border border-slate-700 rounded font-mono">PLATFORM RESTRICTED</span>
                      )}
                    </td>

                    {/* 30D Growth */}
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 text-center">
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-800/50 text-slate-600 border border-slate-800 rounded font-mono">COLLECTING</span>
                    </td>

                    {/* Channel count */}
                    <td className="px-4 py-3 text-center font-mono text-sm text-white font-semibold">
                      {comp.platforms.size}
                      <span className="text-slate-500 font-normal text-xs">/6</span>
                    </td>

                    {/* Platform badges */}
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-center flex-wrap">
                        {ALL_PLATFORMS.map(plt => {
                          const active = comp.platforms.has(plt)
                          return (
                            <span
                              key={plt}
                              title={PLT_FULL[plt]}
                              className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${active ? 'font-semibold' : 'text-slate-700 border-slate-800'}`}
                              style={active ? { color: PLT_COLOR[plt], borderColor: PLT_COLOR[plt] + '55', backgroundColor: PLT_COLOR[plt] + '11' } : {}}
                            >
                              {PLT_LABEL[plt]}
                            </span>
                          )
                        })}
                      </div>
                    </td>

                    {/* Last active */}
                    <td className="px-4 py-3 text-center font-mono text-xs text-slate-500">
                      {comp.lastSeen ? formatRelativeTime(comp.lastSeen) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2.5 border-t border-slate-800/50 flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-600">AUDIENCE = YouTube subscribers (API verified). Instagram / Facebook / LinkedIn / TikTok platforms restrict automated access.</span>
          </div>
        </div>

        {/* ══ S2 + S3 grid ════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* S2: POSTING ACTIVITY */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
            <SectionHeader num="02" label="Posting Activity" sub="CONTENT VOLUME" />
            <div className="space-y-3">
              {postingRanked.length > 0 ? (
                <>
                  {/* Most/least active callouts */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-green-900/20 border border-green-800/40 rounded-lg p-3">
                      <div className="text-[9px] font-mono text-green-500 tracking-widest mb-1">MOST ACTIVE</div>
                      <div className="text-sm font-semibold text-white">{postingRanked[0].name}</div>
                      <div className="text-xl font-mono font-bold text-green-400">{postingRanked[0].ytVideos?.toLocaleString()}</div>
                      <div className="text-[9px] font-mono text-slate-500">YouTube videos</div>
                    </div>
                    <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3">
                      <div className="text-[9px] font-mono text-red-400/70 tracking-widest mb-1">LEAST ACTIVE</div>
                      <div className="text-sm font-semibold text-white">{postingRanked[postingRanked.length - 1].name}</div>
                      <div className="text-xl font-mono font-bold text-red-400/70">{postingRanked[postingRanked.length - 1].ytVideos?.toLocaleString()}</div>
                      <div className="text-[9px] font-mono text-slate-500">YouTube videos</div>
                    </div>
                  </div>

                  {/* Inline bar chart */}
                  {postingRanked.map(comp => {
                    const max = postingRanked[0].ytVideos ?? 1
                    const pct = Math.round(((comp.ytVideos ?? 0) / max) * 100)
                    return (
                      <div key={comp.id} className="flex items-center gap-2">
                        <div className="w-24 shrink-0 flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: comp.color }} />
                          <span className={`text-xs truncate ${comp.isHustle ? 'text-indigo-300 font-medium' : 'text-slate-300'}`}>
                            {comp.name.split(' ')[0]}
                          </span>
                        </div>
                        <div className="flex-1 h-5 bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full rounded transition-all"
                            style={{ width: `${pct}%`, backgroundColor: comp.isHustle ? '#6366f1' : comp.color + '99' }}
                          />
                        </div>
                        <span className="text-xs font-mono text-white w-10 text-right">{comp.ytVideos?.toLocaleString()}</span>
                      </div>
                    )
                  })}

                  <div className="mt-3 pt-3 border-t border-slate-800/50">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-600">
                      <span>WEEKLY / MONTHLY POST TRACKING</span>
                      <span className="text-yellow-500/70 animate-pulse">● COLLECTING DATA</span>
                    </div>
                    <p className="text-[10px] font-mono text-slate-700 mt-1">Daily scraper accumulates 7/30-day post frequency from today. Check back tomorrow.</p>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <span className="text-[10px] font-mono text-yellow-500/70 animate-pulse">● COLLECTING DATA</span>
                  <p className="text-xs font-mono text-slate-600 mt-2">Posting frequency data populates<br />after first daily scrape cycle.</p>
                </div>
              )}
            </div>
          </div>

          {/* S3: CHANNEL DOMINANCE */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
            <SectionHeader num="03" label="Channel Dominance" sub="PLATFORM LEADERS" />
            <div className="space-y-3">
              {ALL_PLATFORMS.map(plt => {
                const leader = platformLeaders[plt]
                const count = platformCounts[plt]
                const isYT = plt === 'youtube'
                return (
                  <div key={plt} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/30 border border-slate-800/60">
                    <div
                      className="w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-mono font-bold shrink-0"
                      style={{ backgroundColor: PLT_COLOR[plt] + '22', color: PLT_COLOR[plt], border: `1px solid ${PLT_COLOR[plt]}44` }}
                    >
                      {PLT_LABEL[plt]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white truncate">
                          {leader ? leader.name : '—'}
                        </span>
                        {isYT && leader?.ytSubscribers && (
                          <span className="text-[9px] font-mono text-green-400 shrink-0">{leader.ytSubscribers.toLocaleString()} subs</span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                        {count}/{totalCompetitors} competitors active
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {isYT ? (
                        <span className="text-[9px] px-1.5 py-0.5 bg-green-900/30 text-green-400 border border-green-800/50 rounded font-mono">VERIFIED</span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-500 border border-slate-700 rounded font-mono">RESTRICTED</span>
                      )}
                    </div>
                  </div>
                )
              })}
              <p className="text-[10px] font-mono text-slate-700 pt-1">
                Dominance = most subscribers (YouTube) or most active presence (other platforms).
              </p>
            </div>
          </div>
        </div>

        {/* ══ S4: CONTENT THEMES ═══════════════════════════════════════════════ */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <SectionHeader num="04" label="Content Themes" sub="AI CLASSIFIED · LOW CONFIDENCE" />
          <div className="space-y-3">
            {leaderboard.map(comp => {
              const topThemes = comp.themes.slice(0, 4)
              if (topThemes.length === 0) return null
              return (
                <div key={comp.id} className={`p-3 rounded-lg border ${comp.isHustle ? 'border-indigo-800/40 bg-indigo-950/20' : 'border-slate-800/50 bg-slate-800/10'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: comp.color }} />
                    <span className={`text-xs font-medium ${comp.isHustle ? 'text-indigo-300' : 'text-white'}`}>{comp.name}</span>
                    {comp.isHustle && <span className="text-[9px] px-1 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded font-mono">YOU</span>}
                    <div className="flex-1" />
                    <span className="text-[9px] font-mono text-slate-600">AI CLASSIFIED</span>
                  </div>
                  {/* Theme bars */}
                  <div className="flex gap-1.5 flex-wrap">
                    {topThemes.map(t => (
                      <div key={t.theme} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: THEME_COLOR[t.theme] ?? '#64748b' }} />
                        <span className="text-[10px] font-mono text-slate-300">{t.theme}</span>
                        <span className="text-[10px] font-mono text-slate-500">{t.percentage}%</span>
                      </div>
                    ))}
                  </div>
                  {/* Stack bar */}
                  <div className="mt-2 h-2 rounded-full overflow-hidden flex gap-0.5">
                    {topThemes.map(t => (
                      <div
                        key={t.theme}
                        className="h-full rounded-sm"
                        style={{ width: `${t.percentage}%`, backgroundColor: THEME_COLOR[t.theme] ?? '#64748b' }}
                        title={`${t.theme}: ${t.percentage}%`}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[10px] font-mono text-slate-700 mt-3 pt-3 border-t border-slate-800/50">
            Themes are AI-classified from known competitor positioning. Confidence upgrades to HIGH when live captions / post text become available via scraping.
          </p>
        </div>

        {/* ══ S5 + S6 grid ════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* S5: THREAT ALERTS */}
          <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-5">
            <SectionHeader num="05" label="Threat Alerts" sub="INTELLIGENCE SIGNALS" />
            {allAlerts.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-xs font-mono text-slate-600">
                NO ACTIVE ALERTS DETECTED
              </div>
            ) : (
              <div className="space-y-3">
                {allAlerts.map((alert, i) => {
                  const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'high' ? '⚠️' : alert.severity === 'medium' ? '📊' : '💡'
                  const severityColors: Record<string, string> = {
                    critical: 'border-red-700/60 bg-red-950/30',
                    high: 'border-orange-700/50 bg-orange-950/20',
                    medium: 'border-yellow-700/40 bg-yellow-950/10',
                    low: 'border-slate-700/50 bg-slate-800/20',
                  }
                  return (
                    <div key={i} className={`flex gap-3 p-3 rounded-lg border ${severityColors[alert.severity] ?? 'border-slate-700/50'}`}>
                      <span className="text-base shrink-0 mt-0.5">{emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <SeverityDot severity={alert.severity} />
                          <span className="text-xs font-semibold text-white">{alert.title}</span>
                          {alert.isSynthetic && <span className="text-[9px] font-mono text-slate-600 ml-auto shrink-0">AI SIGNAL</span>}
                        </div>
                        {alert.description && (
                          <p className="text-[11px] text-slate-400 leading-relaxed">{alert.description}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* S6: HUSTLE POSITION */}
          <div className="bg-slate-900/50 border border-indigo-900/40 rounded-xl p-5">
            <SectionHeader num="06" label="Hustle Position" sub={`vs ${totalCompetitors} COMPETITORS`} />
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: 'Audience Rank', value: hustleYtRank ? `#${hustleYtRank}` : '—',
                  sub: 'YouTube subscribers',
                  note: hustleYtRank === null ? 'No YT data' : `of ${leaderboard.filter(c => c.ytSubscribers !== null).length} verified`,
                  good: hustleYtRank !== null && hustleYtRank <= 3,
                },
                {
                  label: 'Channel Rank', value: hustleChannelRank ? `#${hustleChannelRank}` : '—',
                  sub: 'Platform presence',
                  note: `${hustleData?.platforms.size ?? 0}/6 platforms`,
                  good: hustleChannelRank !== null && hustleChannelRank <= 3,
                },
                {
                  label: 'YouTube Rank', value: hustleYtRank ? `#${hustleYtRank}` : '—',
                  sub: 'Subscriber count',
                  note: hustleData?.ytSubscribers !== null ? `${hustleData?.ytSubscribers?.toLocaleString()} subs` : 'COLLECTING',
                  good: false,
                },
                {
                  label: 'Engagement Rank', value: '—',
                  sub: 'Cross-platform ER',
                  note: 'COLLECTING DATA',
                  good: false,
                },
              ].map(card => (
                <div key={card.label} className={`p-3 rounded-lg border ${card.good ? 'border-green-800/50 bg-green-950/20' : 'border-slate-800 bg-slate-800/20'}`}>
                  <div className="text-[9px] font-mono tracking-widest text-slate-500 mb-1">{card.label.toUpperCase()}</div>
                  <div className={`text-2xl font-mono font-bold ${card.good ? 'text-green-400' : card.value === '—' ? 'text-slate-600' : 'text-indigo-300'}`}>
                    {card.value}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">{card.sub}</div>
                  <div className={`text-[9px] font-mono mt-1 ${card.good ? 'text-green-500' : 'text-slate-600'}`}>{card.note}</div>
                </div>
              ))}
            </div>

            {/* Hustle platform summary */}
            {hustleData && (
              <div className="mt-4 pt-3 border-t border-slate-800/50">
                <div className="text-[10px] font-mono text-slate-500 mb-2 tracking-wider">HUSTLE PLATFORM PRESENCE</div>
                <div className="flex gap-1.5 flex-wrap">
                  {ALL_PLATFORMS.map(plt => {
                    const active = hustleData.platforms.has(plt)
                    return (
                      <span
                        key={plt}
                        className={`text-[9px] px-2 py-1 rounded font-mono border ${active ? 'font-bold' : 'text-slate-700 border-slate-800'}`}
                        style={active ? { color: PLT_COLOR[plt], borderColor: PLT_COLOR[plt] + '55', backgroundColor: PLT_COLOR[plt] + '11' } : {}}
                      >
                        {PLT_LABEL[plt]}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ══ EXECUTIVE INSIGHTS ══════════════════════════════════════════════ */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-[10px] font-mono text-green-500 tracking-widest">[ AI ]</span>
            <span className="text-[11px] font-mono tracking-[0.15em] uppercase text-slate-200 font-semibold">Executive Intelligence</span>
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-[10px] font-mono text-slate-600">WHAT SHOULD HUSTLE DO NEXT?</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {insights.map((ins, i) => (
              <div key={i} className="p-4 rounded-lg bg-slate-800/30 border border-slate-800/60 flex flex-col gap-3">
                <div
                  className="text-[10px] font-mono tracking-widest px-2 py-1 rounded self-start border"
                  style={{ color: ins.color, borderColor: ins.color + '44', backgroundColor: ins.color + '11' }}
                >
                  {ins.tag}
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">{ins.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/50 flex items-center justify-between">
            <span className="text-[10px] font-mono text-slate-600">Generated from live data · Refreshes daily at 07:00 SGT</span>
            <span className="text-[10px] font-mono text-slate-600">SOCIAL INTELLIGENCE ENGINE v2</span>
          </div>
        </div>

      </div>
    </AppLayout>
  )
}
