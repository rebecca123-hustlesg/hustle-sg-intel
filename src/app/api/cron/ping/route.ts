import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  const results: Record<string, unknown> = {}

  results.has_supabase_url = !!process.env.NEXT_PUBLIC_SUPABASE_URL
  results.has_service_key = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  results.has_youtube_key = !!process.env.YOUTUBE_API_KEY

  try {
    const supabase = await createServiceClient()

    // Test 1: read competitors
    const { data: competitors, error: compErr } = await supabase
      .from('competitors')
      .select('id, name')
      .limit(1)
    results.read_competitors_ok = !compErr
    results.read_competitors_error = compErr?.message ?? null

    // Test 2: read social_profiles
    const { data: profiles, error: profErr } = await supabase
      .from('social_profiles')
      .select('id, platform, handle')
      .eq('active', true)
      .limit(1)
    results.read_profiles_ok = !profErr
    results.read_profiles_error = profErr?.message ?? null
    results.first_profile = profiles?.[0] ? { platform: profiles[0].platform, handle: profiles[0].handle } : null

    // Test 3: insert into social_metrics
    if (competitors?.[0] && profiles?.[0]) {
      const { error: insertErr } = await supabase.from('social_metrics').insert({
        profile_id: profiles[0].id,
        competitor_id: competitors[0].id,
        platform: profiles[0].platform,
        followers: null,
        data_source: 'unavailable',
        error_message: 'ping_test',
      })
      results.insert_ok = !insertErr
      results.insert_error = insertErr?.message ?? null

      // Clean up test row
      if (!insertErr) {
        await supabase.from('social_metrics')
          .delete()
          .eq('error_message', 'ping_test')
          .eq('competitor_id', competitors[0].id)
        results.cleanup_done = true
      }
    }

    // Test 4: try LinkedIn scrape (known to return 999)
    try {
      const linkedinRes = await fetch('https://www.linkedin.com/company/hustle-singapore', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10_000),
      })
      results.linkedin_status = linkedinRes.status
      results.linkedin_ok = true
    } catch (e) {
      results.linkedin_ok = false
      results.linkedin_error = e instanceof Error ? e.message : String(e)
    }

  } catch (e) {
    results.fatal_error = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json({ ok: true, duration_ms: Date.now() - start, results })
}
