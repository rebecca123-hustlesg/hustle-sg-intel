import { Sidebar } from './sidebar'
import { Header } from './header'
import { createClient } from '@/lib/supabase/server'

interface AppLayoutProps {
  children: React.ReactNode
  title?: string
  lastUpdated?: string | null
}

export async function AppLayout({ children, title, lastUpdated }: AppLayoutProps) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const userEmail = user?.email ?? null
  const userInitial = userEmail ? userEmail[0].toUpperCase() : null

  return (
    <div className="min-h-screen bg-[#09090f]">
      <Sidebar />
      {/* Content: no left margin on mobile, 256px (w-64) on md+ */}
      <div className="md:ml-64">
        <Header
          title={title ?? 'Intel'}
          lastUpdated={lastUpdated}
          userEmail={userEmail}
          userInitial={userInitial}
        />
        {/* Extra left padding on mobile to clear the hamburger button */}
        <main className="p-6 pl-6 md:pl-6">
          {children}
        </main>
      </div>
    </div>
  )
}
