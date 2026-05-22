import { useEffect, useState, useRef, useCallback } from 'react'
import { User } from 'lucide-react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { UserDashboard } from '@/components/UserDashboard'
import { UserSetupModal } from '@/components/UserSetupModal'
import { getUser, saveUser, clearUser, type UserProfile } from '@/lib/registrationStore'
import { fetchUserProfileByEmail } from '@/lib/apiClient'
import { getAppUrl } from '@/lib/appUrl'
import supabase from '@/lib/supabase'
import { toast } from 'sonner'

export function ProfilePage() {
  const [user, setUser] = useState(getUser)
  const [syncingProfile, setSyncingProfile] = useState(false)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const isProfileComplete = useCallback((profile: UserProfile | null | undefined) =>
    !!profile?.name?.trim() &&
    !!profile?.registerNumber?.trim() &&
    !!profile?.house?.trim(),
  [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setShowSetupModal(params.get('signup') === '1')
  }, [location.search])

  useEffect(() => {
    if (!user?.email || isProfileComplete(user)) {
      setSyncingProfile(false)
      return
    }

    let cancelled = false

    const syncProfile = async () => {
      setSyncingProfile(true)

      try {
        const result = await fetchUserProfileByEmail(user.email)
        if (cancelled || !result.user) {
          return
        }

        const syncedUser: UserProfile = {
          email: result.user.email.toLowerCase(),
          name: result.user.name || user.name,
          picture: result.user.picture_url || user.picture,
          registerNumber: result.user.register_number || user.registerNumber,
          mobileNumber: result.user.mobile_number || user.mobileNumber,
          house: result.user.house || user.house,
        }

        saveUser(syncedUser)
        setUser(syncedUser)
      } catch {
        // Keep the session-backed profile if the API is unavailable.
      } finally {
        if (!cancelled) {
          setSyncingProfile(false)
        }
      }
    }

    void syncProfile()

    return () => {
      cancelled = true
    }
  }, [user?.email, user, isProfileComplete])

  const refreshUser = () => {
    setUser(getUser())
  }

  // -- Supabase auth handling -------------------------------------------------
  const INACTIVITY_MS = 30 * 60 * 1000 // 30 minutes
  const inactivityTimer = useRef<number | null>(null)

  const clearInactivityTimer = () => {
    if (inactivityTimer.current) {
      window.clearTimeout(inactivityTimer.current)
      inactivityTimer.current = null
    }
  }

  const signOutLocal = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } catch {}
    clearUser()
    setUser(null)
  }, [])

  const handleInactivityLogout = useCallback(async () => {
    await signOutLocal()
    toast('Signed out due to inactivity')
  }, [signOutLocal])

  const resetInactivityTimer = useCallback(() => {
    clearInactivityTimer()
    inactivityTimer.current = window.setTimeout(() => void handleInactivityLogout(), INACTIVITY_MS)
  }, [handleInactivityLogout])

  const setupActivityListeners = useCallback((enabled: boolean) => {
    const events = ['mousemove', 'keydown', 'click', 'scroll'] as const
    if (enabled) {
      events.forEach((ev) => window.addEventListener(ev, resetInactivityTimer))
      resetInactivityTimer()
    } else {
      events.forEach((ev) => window.removeEventListener(ev, resetInactivityTimer))
      clearInactivityTimer()
    }
  }, [resetInactivityTimer])

  const handleSession = useCallback(async (session: any) => {
    const u = session?.user
    if (!u || !u.email) return

    const email = (u.email as string).toLowerCase()
    if (!email.endsWith('@saveetha.com')) {
      await supabase.auth.signOut()
      clearUser()
      setUser(null)
      toast.error('Only @saveetha.com accounts are allowed.')
      return
    }

    setSyncingProfile(true)
    try {
      const backendProfile = await fetchUserProfileByEmail(email)
      const userData = backendProfile.user
      const profile: UserProfile = {
        email,
        name: userData?.name || (u.user_metadata?.name as string) || '',
        picture:
          userData?.picture_url ||
          (u.user_metadata?.avatar_url as string) ||
          `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(userData?.name || u.user_metadata?.name || email)}`,
        registerNumber: userData?.register_number || '',
        mobileNumber: userData?.mobile_number || undefined,
        house: userData?.house || '',
      }

      // Upsert into profiles table (optional)
      try {
        await supabase.from('profiles').upsert({ id: u.id, email: profile.email, name: profile.name, avatar_url: profile.picture })
      } catch {}

      saveUser(profile)
      setUser(profile)
      setShowSetupModal(!isProfileComplete(profile))

      // start inactivity timer and listeners
      setupActivityListeners(true)
    } finally {
      setSyncingProfile(false)
    }
  }, [isProfileComplete, setupActivityListeners])

  useEffect(() => {
    let mounted = true

    const init = async () => {
      setSyncingProfile(true)
      try {
        // Check existing session
        const { data: sessionData } = await supabase.auth.getSession()
        const session = sessionData?.session
        if (session) await handleSession(session)

        // Listen for auth changes
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!mounted) return
          if (session) {
            void handleSession(session)
          } else {
            setupActivityListeners(false)
            clearUser()
            setUser(null)
          }
        })

        return () => {
          mounted = false
          try { data.subscription.unsubscribe() } catch {}
        }
      } finally {
        if (mounted) setSyncingProfile(false)
      }
    }

    void init()

    // logout on tab close
    const beforeUnload = () => { void signOutLocal() }
    window.addEventListener('beforeunload', beforeUnload)

    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      setupActivityListeners(false)
    }
  }, [handleSession, setupActivityListeners, signOutLocal])

  const handleGoogleSignIn = async () => {
    setAuthLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getAppUrl('/profile'),
          queryParams: { hd: 'saveetha.com' },
        },
      })

      if (error) {
        toast.error(error.message || 'Unable to start Google sign-in')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Sign in failed')
    } finally {
      setAuthLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-background">
      <Navbar />

      <main className="relative pt-32 pb-24 min-h-[80vh]">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-background via-[#D4AF37]/5 to-background" />
          <div className="absolute inset-0 grid-bg opacity-30" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-4">
          <div className="mb-10 text-center">
            <h1 className="font-display text-4xl md:text-5xl font-black text-white mb-3">
              User <span className="text-[#D4AF37]">Profile</span>
            </h1>
            <p className="text-white/50 text-sm tracking-wide">
              Manage your registrations, check-ins, and OD eligibility.
            </p>
          </div>

          {user ? (
            syncingProfile ? (
              <div className="mx-auto mt-16 max-w-md rounded-2xl border border-white/10 bg-[#0d0d0d] p-8 text-center text-sm text-white/50">
                Syncing profile from the database...
              </div>
            ) : isProfileComplete(user) ? (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <UserDashboard
                  user={user}
                  onSignOut={() => void signOutLocal()}
                />
              </div>
            ) : (
              <div className="max-w-md mx-auto mt-16 rounded-2xl border border-white/10 bg-[#0d0d0d] p-8 text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 mx-auto">
                  <User className="h-10 w-10 text-[#D4AF37]" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2 font-display">Complete Your Profile</h2>
                <p className="text-white/40 text-sm mb-8 px-4">
                  We found your Google account, but you still need to provide your SIMMAM registration details before accessing the dashboard.
                </p>
                <button
                  type="button"
                  onClick={() => setShowSetupModal(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[oklch(0.55_0.22_27)] to-[#D4AF37] px-6 py-4 text-sm font-bold text-black hover:scale-105 hover:shadow-[0_0_30px_#D4AF3740] transition-all"
                >
                  Complete Profile
                </button>
              </div>
            )
          ) : (
            <div className="max-w-md mx-auto mt-16 text-center animate-in fade-in zoom-in-95 duration-500">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10">
                <User className="h-10 w-10 text-[#D4AF37]" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 font-display">Login Required</h2>
              <p className="text-white/40 text-sm mb-8">
                Login with your Saveetha email to access your SIMMAM 2026 dashboard.
              </p>
              <div className="space-y-3">
                <button
                  onClick={handleGoogleSignIn}
                  disabled={authLoading}
                  className="inline-flex w-full items-center justify-center gap-3 px-6 py-4 rounded-xl bg-gradient-to-r from-[oklch(0.55_0.22_27)] to-[#D4AF37] text-black font-bold hover:scale-105 hover:shadow-[0_0_30px_#D4AF3740] transition-all disabled:opacity-60"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
                    <path fill="#EA4335" d="M24 9.5c3.9 0 7.2 1.4 9.7 3.6l7.1-7.1C36.5 2.2 30.6 0 24 0 14.7 0 6.8 5.2 2.9 12.7l8.3 6.4C12.9 14.2 18.1 9.5 24 9.5z"/>
                    <path fill="#34A853" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.6H24v9h12.7c-.6 3.2-2.6 5.8-5.5 7.6l8.4 6.5C43.5 39.1 46.5 32.4 46.5 24.5z"/>
                    <path fill="#4A90E2" d="M10.3 29.1A14.9 14.9 0 0 1 9 24.5c0-1.6.3-3.1.8-4.6L2.9 13.6A24 24 0 0 0 0 24.5c0 3.8.9 7.3 2.9 10.6l7.4-6z"/>
                    <path fill="#FBBC05" d="M24 48c6.6 0 12.5-2.2 17.2-6l-8.4-6.5c-2.6 1.8-5.9 2.8-8.8 2.8-5.9 0-11.1-4.7-12.8-11.1L2.9 35.3C6.8 42.8 14.7 48 24 48z"/>
                  </svg>
                  {authLoading ? 'Signing in...' : 'Continue with Google'}
                </button>
                <p className="text-xs text-white/40">Only @saveetha.com accounts are allowed.</p>
              </div>
            </div>
          )}
        </div>
      </main>

      <Footer />

      {showSetupModal && (
        <UserSetupModal
          onSave={() => {
            refreshUser()
            setShowSetupModal(false)
          }}
          onClose={() => {
            setShowSetupModal(false)
            void navigate({ to: '/profile', replace: true })
          }}
        />
      )}
    </div>
  )
}
