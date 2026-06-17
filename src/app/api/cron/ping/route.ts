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
    const { data, error } = await supabase.from('competitors').select('id, name').limit(3)
    results.supabase_ok = !error
    results.supabase_error = error?.message ?? null
    results.competitors_found = data?.length ?? 0
    results.sample = data?.map(c => c.name) ?? []
  } catch (e) {
    results.supabase_ok = false
    results.supabase_error = e instanceof Error ? e.message : String(e)
  }

  if (process.env.YOUTUBE_API_KEY) {
    try {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=@heicoders&key=${process.env.YOUTUBE_API_KEY}`,
        { signal: AbortSignal.timeout(10_000) }
      )
      results.youtube_status = r.status
      results.youtube_ok = r.ok
    } catch (e) {
      results.youtube_ok = false
      results.youtube_error = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json({ ok: true, duration_ms: Date.now() - start, results })
}
