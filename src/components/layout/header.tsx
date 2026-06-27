'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { RefreshCw, LogOut, User, ChevronDown } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

interface HeaderProps {
  title?: string
  lastUpdated?: string | null
  module?: string
  userEmail?: string | null
  userInitial?: string | null
}

export function Header({ title = 'Intel', lastUpdated, module, userEmail, userInitial }: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [justRefreshed, setJustRefreshed] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const handleRefresh = async () => {
    if (!module || refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    try {
      const res = await fetch(`/api/refresh?module=${encodeURIComponent(module)}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Refresh failed (${res.status})`)
      }
      setJustRefreshed(true)
      router.refresh()
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <header className="h-14 border-b border-slate-800 flex items-center justify-between px-6 pl-14 md:pl-6 bg-[#09090f]/90 backdrop-blur sticky top-0 z-30">
      {/* Left: Page title */}
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-white">{title}</h1>
        {lastUpdated && (
          module ? (
            <span className="hidden sm:flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh data"
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors disabled:cursor-not-allowed disabled:opacity-80"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing
                  ? 'Updating…'
                  : justRefreshed
                    ? 'Updated just now'
                    : `Updated ${formatRelativeTime(lastUpdated)}`}
              </button>
              {refreshError && (
                <span className="text-red-400 max-w-[220px] truncate" title={refreshError}>
                  {refreshError}
                </span>
              )}
            </span>
          ) : (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
              <RefreshCw className="h-3 w-3" />
              Updated {formatRelativeTime(lastUpdated)}
            </span>
          )
        )}
      </div>

      {/* Right: User menu */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-500/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-semibold text-xs">
            {userInitial ?? <User className="h-3.5 w-3.5" />}
          </div>
          <span className="hidden sm:block text-sm text-slate-300 max-w-[140px] truncate">
            {userEmail ?? 'User'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        </button>

        {dropdownOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setDropdownOpen(false)}
            />
            {/* Dropdown */}
            <div className="absolute right-0 top-full mt-1 w-52 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-20 py-1">
              <div className="px-4 py-2.5 border-b border-slate-700/50">
                <p className="text-xs font-medium text-white truncate">
                  {userEmail ?? 'User'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Hustle SG</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
