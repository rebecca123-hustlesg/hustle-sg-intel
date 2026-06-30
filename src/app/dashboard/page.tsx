import { AppLayout } from '@/components/layout/app-layout'
import { MetricCard } from '@/components/dashboard/metric-card'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { SocialBarChart } from '@/components/charts/social-bar-chart'
import { createClient } from '@/lib/supabase/server'
import { getSocialRanking } from '@/lib/services/queries/social'
import { getActiveJobs } from '@/lib/services/queries/hiring'
import { formatRelativeTime, getSeverityBgClass, cn } from '@/lib/utils'
import { Trophy, TrendingUp, Users, Zap } from 'lucide-react'
import Link from 'next/link'

export const revalidate = 300 // Revalidate every 5 minutes

async function getDashboardData() {
  const supabase = await createClient()

  // The Dashboard is an aggregation layer only: social ranking and active jobs
  // come from the SAME shared query helpers the module pages use, so the numbers
  // are guaranteed identical. Counts come from the canonical tables.
  const [
    ranking,
    activeJobs,
    insightsRes,
    competitorCountRes,
    lastSocialRes,
  ] = await Promise.all([
    getSocialRanking(),
    getActiveJobs(),
    supabase
      .from('strategic_insights')
      .select('id, insight_type, title, body, severity, created_at')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(3),
    supabase.from('competitors').select('id', { count: 'exact', head: true }).eq('active', true),
    supabase
      .from('social_metrics')
      .select('scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const hustleEntry = ranking.find((r) => r.is_hustle)

  // Aggregations derived purely from the shared helpers — no new business rules.
  const summary = {
    total_competitors: competitorCountRes.count ?? ranking.length,
    hustle_social_rank: hustleEntry?.rank ?? null,
    active_job_postings: activeJobs.jobs.length,
  }

  return {
    summary,
    ranking,
    insights: insightsRes.data ?? [],
    lastUpdated: lastSocialRes.data?.scraped_at ?? null,
  }
}

const insightTypeLabel: Record<string, string> = {
  threat: 'Threat',
  opportunity: 'Opportunity',
  recommendation: 'Recommendation',
  market_position: 'Market Position',
  growth_analysis: 'Growth Analysis',
  social_insight: 'Social',
  hiring_intel: 'Hiring',
  course_intel: 'Course Intel',
}

export default async function DashboardPage() {
  const { summary, ranking, insights, lastUpdated } = await getDashboardData()

  // Build bar chart data from ranking
  const barChartData = ranking.map((r) => ({
    name: r.competitor_name,
    followers: r.total_followers > 0 ? r.total_followers : null,
    color: r.competitor_color,
    is_hustle: r.is_hustle,
  }))

  // Find Hustle rank
  const hustleEntry = ranking.find((r) => r.is_hustle)

  return (
    <AppLayout title="Dashboard" lastUpdated={lastUpdated}>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <MetricCard
          label="Our Social Rank"
          value={summary?.hustle_social_rank ?? null}
          format="rank"
          source="scraped"
          lastUpdated={lastUpdated}
          icon={<Trophy className="h-4 w-4" />}
          highlight
          suffix={` of ${summary?.total_competitors ?? 10}`}
        />
        <MetricCard
          label="Total Social Reach"
          value={hustleEntry?.total_followers ?? null}
          source="scraped"
          lastUpdated={lastUpdated}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          label="Active Job Postings"
          value={summary?.active_job_postings ?? null}
          source="scraped"
          icon={<Users className="h-4 w-4" />}
        />
      </div>

      <div className="mb-6">
        {/* Social Ranking Chart */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-white">Social Reach Ranking</h2>
              <p className="text-xs text-slate-500 mt-0.5">Total followers across all platforms</p>
            </div>
            <Link
              href="/social-intelligence"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View full →
            </Link>
          </div>
          {barChartData.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <DataUnavailable label="No social data collected yet" />
            </div>
          ) : (
            <SocialBarChart data={barChartData} />
          )}
          {lastUpdated && (
            <p className="text-[11px] text-slate-600 mt-3 text-right">
              Last scraped: {formatRelativeTime(lastUpdated)} · src:scraped
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* AI Insights Preview */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">AI Strategic Insights</h2>
            </div>
            <Link
              href="/opportunity-engine"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View all →
            </Link>
          </div>

          {insights.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <Zap className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No insights generated yet</p>
              <p className="text-xs text-slate-600 mt-1">Run the AI cron to generate insights</p>
            </div>
          ) : (
            <div className="space-y-3">
              {insights.map((insight: {
                id: string
                insight_type: string
                title: string
                body: string
                severity: string
                created_at: string
              }) => (
                <div
                  key={insight.id}
                  className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
                      getSeverityBgClass(insight.severity)
                    )}>
                      {insightTypeLabel[insight.insight_type] ?? insight.insight_type}
                    </span>
                    <span className="text-[11px] text-slate-600">
                      {formatRelativeTime(insight.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-white leading-snug">{insight.title}</p>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{insight.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
