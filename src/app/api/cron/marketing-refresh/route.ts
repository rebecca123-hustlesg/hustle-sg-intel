/**
 * Cron: Marketing Intelligence Refresh
 * Schedule: 0 20 * * * (UTC) = 4:00 AM SGT daily
 *
 * Protected by CRON_SECRET — Vercel passes this automatically.
 * Pipeline: Meta Ads → Google Reviews/Rating → SF data sync → log.
 */

import { NextResponse } from 'next/server'
import { runMarketingRefresh } from '@/lib/services/marketing/refresh'

export const maxDuration = 300 // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    const result = await runMarketingRefresh('cron')
    const duration_ms = Date.now() - startTime

    return NextResponse.json({
      success:     true,
      result,
      duration_ms,
      timestamp:   new Date().toISOString(),
    })
  } catch (err) {
    const duration_ms = Date.now() - startTime
    console.error('[marketing-refresh cron] Fatal error:', err)
    return NextResponse.json(
      {
        success:     false,
        error:       err instanceof Error ? err.message : String(err),
        duration_ms,
        timestamp:   new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
