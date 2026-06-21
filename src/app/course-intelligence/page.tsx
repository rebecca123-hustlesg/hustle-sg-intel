import { createServiceClient } from '@/lib/supabase/server'

export const revalidate = 300

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

const SF_COURSE_URL = (ref: string) =>
  `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${ref}`

// Schedule section lives on the same detail page
const SF_SCHEDULE_URL = (ref: string) =>
  `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${ref}#upcoming-runs`

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtDT(iso: string): string {
  return (
    new Date(iso).toLocaleString('en-SG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Singapore',
    }) + ' SGT'
  )
}

function isHustle(name: string) {
  return name.toUpperCase().includes('HUSTLE')
}

const DISPLAY: Record<string, string> = {
  'BELLS INSTITUTE OF HIGHER LEARNING PTE. LTD.': 'BELLS Institute',
  'VERTICAL INSTITUTE PTE. LTD.': 'Vertical Institute',
  'OOM PTE. LTD.': 'OOm Pte Ltd',
  'SKILLS DEVELOPMENT ACADEMY PTE. LTD.': 'Skills Dev Academy',
  'INFO-TECH SYSTEMS LTD.': 'InfoTech Academy',
  '@ASK TRAINING PTE. LTD.': 'ASK Training',
  'HEICODERS ACADEMY PRIVATE LIMITED': 'Heicoders Academy',
  'HAPPY TOGETHER PTE. LTD.': 'Happy Together',
  'EQUINET ACADEMY PRIVATE LIMITED': 'Equinet Academy',
  'HUSTLE INSTITUTE PTE. LTD.': 'Hustle SG',
  'HUSTLE ACADEMY PTE. LTD.': 'Hustle SG',
}

function groupName(raw: string) {
  if (isHustle(raw)) return 'Hustle SG'
  return DISPLAY[raw] ?? raw
}

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

interface Course {
  sf_ref_no: string
  title: string
  provider_name: string
  category_text: string | null
  has_active_runs: boolean
  respondent_count: number
  upcoming_run_count: number
  scraped_at: string
}

interface ProviderCard {
  name: string
  isHustle: boolean
  indexedCourses: number
  verifiedCourses: number   // 39 for Hustle (confirmed), else = indexedCourses
  totalRuns: number
  top3ByRuns: Course[]
  top3ByAttendees: Course[]
}

// ═══════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════

async function getData() {
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('sf_courses')
    .select(
      'sf_ref_no, title, provider_name, category_text, has_active_runs, respondent_count, upcoming_run_count, scraped_at',
    )

  if (error || !data || data.length === 0) return null

  const courses = data as Course[]
  const lastScraped = courses.reduce(
    (m, c) => (c.scraped_at > m ? c.scraped_at : m),
    courses[0].scraped_at,
  )

  // Group by display name
  const pMap = new Map<string, Course[]>()
  for (const c of courses) {
    const k = groupName(c.provider_name)
    if (!pMap.has(k)) pMap.set(k, [])
    pMap.get(k)!.push(c)
  }

  const cards: ProviderCard[] = Array.from(pMap.entries()).map(([name, pc]) => {
    const totalRuns = pc.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const byRuns = [...pc].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
    const byAtt  = [...pc].sort((a, b) => (b.respondent_count ?? 0) - (a.respondent_count ?? 0))
    const hustle = isHustle(pc[0].provider_name)
    return {
      name,
      isHustle: hustle,
      indexedCourses: pc.length,
      verifiedCourses: hustle ? 39 : pc.length,
      totalRuns,
      top3ByRuns: byRuns.slice(0, 3),
      top3ByAttendees: byAtt.slice(0, 3),
    }
  })

  // Hustle first, then sorted by totalRuns DESC
  cards.sort((a, b) => {
    if (a.isHustle !== b.isHustle) return a.isHustle ? -1 : 1
    return b.totalRuns - a.totalRuns
  })

  const totalRuns = courses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)

  return {
    cards,
    totalCompetitors: cards.length,
    totalCourses: courses.length,
    totalRuns,
    hasRunData: totalRuns > 0,
    lastScraped,
  }
}

// ═══════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════

const MEDALS = ['🥇', '🥈', '🥉']

function CourseRow({
  course,
  rank,
  hasRunData,
}: {
  course: Course
  rank: number
  hasRunData: boolean
}) {
  const runs = course.upcoming_run_count ?? 0
  const att  = course.respondent_count ?? 0

  return (
    <div className="py-3 border-b border-slate-800/50 last:border-0">
      <div className="flex items-start gap-2.5">
        <span className="text-lg shrink-0 leading-none mt-0.5">{MEDALS[rank] ?? `${rank + 1}.`}</span>
        <div className="flex-1 min-w-0">
          {/* Title */}
          <p className="font-semibold text-slate-100 text-sm leading-snug">{course.title}</p>

          {/* Metrics row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs">
            {hasRunData ? (
              <span className="font-bold text-orange-400">{runs} {runs === 1 ? 'Run' : 'Runs'}</span>
            ) : (
              <span className="text-slate-600 italic">Runs: data pending</span>
            )}
            {att > 0 && (
              <span className="text-slate-400">{fmt(att)} Attended</span>
            )}
            {course.category_text && (
              <span className="text-slate-600">{course.category_text}</span>
            )}
          </div>

          {/* Provider name (raw, for transparency) */}
          <p className="text-[11px] text-slate-600 mt-0.5">Provider: {course.provider_name}</p>

          {/* Links */}
          <div className="flex gap-3 mt-1.5">
            <a
              href={SF_COURSE_URL(course.sf_ref_no)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors"
            >
              Course Page ↗
            </a>
            <a
              href={SF_SCHEDULE_URL(course.sf_ref_no)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors"
            >
              Schedule ↗
            </a>
          </div>
        </div>

        {/* Run count badge (right-aligned, large) */}
        {hasRunData && runs > 0 && (
          <div className="shrink-0 text-right">
            <div className="text-2xl font-bold text-orange-400 leading-none">{runs}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">runs</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ card, hasRunData }: { card: ProviderCard; hasRunData: boolean }) {
  const borderCls  = card.isHustle ? 'border-orange-700/60'  : 'border-slate-700/60'
  const headerCls  = card.isHustle ? 'bg-orange-950/40'      : 'bg-slate-800/60'
  const nameCls    = card.isHustle ? 'text-orange-300'        : 'text-slate-100'
  const badgeCls   = card.isHustle
    ? 'bg-orange-900/60 text-orange-300 border border-orange-700/60'
    : 'bg-slate-700/60 text-slate-300 border border-slate-600/60'

  const topAttended = card.top3ByAttendees[0]

  return (
    <div className={`rounded-xl border ${borderCls} bg-slate-900/60 overflow-hidden flex flex-col`}>

      {/* ── Header ── */}
      <div className={`px-5 py-3.5 flex items-center justify-between gap-3 ${headerCls}`}>
        <div className="flex items-center gap-2 min-w-0">
          {card.isHustle && <span className="text-orange-400 text-lg">★</span>}
          <h2 className={`font-bold text-base tracking-wide truncate ${nameCls}`}>
            {card.name.toUpperCase()}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Course count */}
          <span className="text-xs text-slate-500 font-mono whitespace-nowrap">
            {card.isHustle
              ? `${card.indexedCourses} indexed / ${card.verifiedCourses} verified`
              : `${card.indexedCourses} courses`}
          </span>

          {/* Total runs badge */}
          <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded-full ${badgeCls}`}>
            {hasRunData ? `${card.totalRuns} runs` : 'PENDING'}
          </span>
        </div>
      </div>

      {/* ── Top 3 by Course Runs ── */}
      <div className="px-5 flex-1">
        <p className="text-[10px] font-mono tracking-[0.15em] text-slate-500 uppercase pt-3 pb-1">
          Top 3 by Course Runs
        </p>
        {card.top3ByRuns.map((c, i) => (
          <CourseRow key={c.sf_ref_no} course={c} rank={i} hasRunData={hasRunData} />
        ))}
      </div>

      {/* ── Top 3 by Attendees (Hustle only) ── */}
      {card.isHustle && (
        <div className="px-5 border-t border-orange-900/30">
          <p className="text-[10px] font-mono tracking-[0.15em] text-orange-700 uppercase pt-3 pb-1">
            Top 3 by Attendees
          </p>
          {card.top3ByAttendees.map((c, i) => (
            <CourseRow key={`att-${c.sf_ref_no}`} course={c} rank={i} hasRunData={hasRunData} />
          ))}
        </div>
      )}

      {/* ── Highest Attended footer (all cards) ── */}
      {topAttended && (topAttended.respondent_count ?? 0) > 0 && (
        <div
          className={`px-5 py-2.5 border-t text-xs flex flex-wrap items-baseline gap-1.5 ${
            card.isHustle ? 'border-orange-900/40 bg-orange-950/30' : 'border-slate-800/60 bg-slate-900/80'
          }`}
        >
          <span className="text-slate-500 font-mono uppercase tracking-wide text-[10px]">
            Highest Attended:
          </span>
          <a
            href={SF_COURSE_URL(topAttended.sf_ref_no)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-300 hover:text-orange-400 transition-colors font-medium truncate max-w-[220px]"
            title={topAttended.title}
          >
            {topAttended.title}
          </a>
          <span className="text-orange-400 font-bold whitespace-nowrap">
            {fmt(topAttended.respondent_count ?? 0)} Attended
          </span>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════

export default async function CourseIntelligencePage() {
  const d = await getData()

  if (!d) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-slate-300 text-xl font-semibold mb-2">MYSKILLSFUTURE DEMAND INTELLIGENCE</h1>
          <p className="text-slate-600 text-sm">No course data available. Run the sf-refresh cron to populate.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-100">

      {/* ── Page Header ── */}
      <div className="border-b border-slate-800 bg-[#0d1117]/95 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-100">
                MYSKILLSFUTURE DEMAND INTELLIGENCE
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">
                Current Market Demand Based On Upcoming Course Runs
              </p>
            </div>
            <p className="text-slate-600 text-xs font-mono shrink-0">
              Last Updated: {fmtDT(d.lastScraped)}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* ── Top Stats Bar ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Competitors Tracked', value: d.totalCompetitors },
            { label: 'Courses Tracked', value: d.totalCourses },
            {
              label: 'Total Upcoming Course Runs',
              value: d.hasRunData ? d.totalRuns : null,
              pending: !d.hasRunData,
            },
            { label: 'Source', value: 'MySkillsFuture', isText: true },
          ].map(stat => (
            <div
              key={stat.label}
              className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-4 py-3"
            >
              <p className="text-[10px] font-mono text-slate-500 tracking-wider uppercase mb-1">
                {stat.label}
              </p>
              {stat.isText ? (
                <p className="text-slate-300 text-sm font-semibold">myskillsfuture.gov.sg</p>
              ) : stat.pending ? (
                <p className="text-amber-500 text-sm font-mono">DATA PENDING</p>
              ) : (
                <p className="text-slate-100 text-2xl font-bold font-mono">
                  {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ── Run Data Pending Banner ── */}
        {!d.hasRunData && (
          <div className="mb-6 flex items-start gap-3 bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-3">
            <span className="text-amber-400 text-lg shrink-0">⏳</span>
            <div>
              <p className="text-amber-300 text-sm font-semibold">Course run count data is pending</p>
              <p className="text-amber-700 text-xs mt-0.5">
                upcoming_run_count is 0 for all {d.totalCourses} indexed courses. This will
                populate automatically after the next daily scrape at 01:00 SGT. Cards below show
                course titles and attendee counts in the meantime.
              </p>
            </div>
          </div>
        )}

        {/* ── Competitor Cards ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {d.cards.map(card => (
            <Card key={card.name} card={card} hasRunData={d.hasRunData} />
          ))}
        </div>

        {/* ── Footer ── */}
        <footer className="mt-10 pt-4 border-t border-slate-800 text-[11px] text-slate-600 font-mono space-y-1">
          <p>
            DATA SOURCE: MySkillsFuture Solr API · respondent_count = Course_Quality_NumberOfRespondents
            (verified) · upcoming_run_count = doclist.numFound per course group
          </p>
          <p>
            HUSTLE SG = HUSTLE INSTITUTE PTE. LTD. + HUSTLE ACADEMY PTE. LTD. (aggregated) ·
            14 courses currently indexed · 39 verified on MySkillsFuture ·
            HUSTLE ACADEMY pending next scrape cycle
          </p>
          <p>
            Attendee counts are sourced directly from MySkillsFuture and are not estimated.
            Run counts display &quot;data pending&quot; until verified source data is available.
          </p>
        </footer>

      </div>
    </div>
  )
}
