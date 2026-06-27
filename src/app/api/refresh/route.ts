import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ingestAllSocial } from '@/lib/services/ingestion/social'
import { ingestAllJobs } from '@/lib/services/ingestion/jobs'
import { ingestAllSFCourses } from '@/lib/services/ingestion/sf_courses'
import { scrapeAndUpdateRunCounts } from '@/lib/services/ingestion/sf_run_counts'

export const maxDuration = 300 // 5 minutes — matches the refresh crons

// Manual, user-triggered refresh of RAW source data only.
// Reuses the exact ingestion services the crons call — no duplicated logic,
// and deliberately no AI/Gemini generation here.
type RefreshModule = 'social' | 'hiring' | 'courses'

const MODULE_INGESTION: Record<RefreshModule, () => Promise<void>> = {
  social: async () => {
    await ingestAllSocial()
  },
  hiring: async () => {
    await ingestAllJobs()
  },
  // Courses runs the two SAFE course pipelines sequentially: SF catalog + run counts.
  // The inline MySkillsFuture cron route logic is intentionally NOT wired here.
  courses: async () => {
    await ingestAllSFCourses()
    await scrapeAndUpdateRunCounts()
  },
}

export async function POST(request: NextRequest) {
  // Authenticate via the logged-in Supabase session — never CRON_SECRET.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const moduleParam = request.nextUrl.searchParams.get('module')
  if (!moduleParam || !(moduleParam in MODULE_INGESTION)) {
    return NextResponse.json(
      { success: false, error: `Unknown or unsupported module: ${moduleParam ?? '(none)'}` },
      { status: 400 }
    )
  }

  const startTime = Date.now()

  try {
    await MODULE_INGESTION[moduleParam as RefreshModule]()

    return NextResponse.json({
      success: true,
      module: moduleParam,
      lastUpdated: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    })
  } catch (err) {
    console.error(`Manual refresh error [${moduleParam}]:`, err)
    return NextResponse.json(
      {
        success: false,
        module: moduleParam,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    )
  }
}
