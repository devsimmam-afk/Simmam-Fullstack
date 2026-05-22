import { useState, useEffect } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { useAuth, getAuthorizedAdminRedirect, getStoredAdminUser } from '@/lib/auth'
import { getAppUrl } from '@/lib/appUrl'
import type { AdminRole } from '@/types/admin'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import adminSupabase from '@/lib/adminSupabase'

export const Route = createFileRoute('/wch1925/login')({
  beforeLoad: ({ location }) => {
    const storedUser = getStoredAdminUser()
    if (storedUser) {
      throw redirect({
        to: getAuthorizedAdminRedirect(storedUser, location.search?.redirectTo),
        replace: true,
      })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const search = Route.useSearch() as { redirectTo?: string }
  const [selectedRole, setSelectedRole] = useState<AdminRole>('developer_admin')
  const [error, setError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  useEffect(() => {
    let mounted = true

    const handleSession = async (session: any) => {
      if (!mounted) return
      const pending = window.localStorage.getItem('simmam_admin_google_signin')
      if (!pending) return

      setAuthLoading(true)
      setError('')

      try {
        const emailFromSession = session?.user?.email?.toLowerCase()
        if (!emailFromSession) {
          window.localStorage.removeItem('simmam_admin_google_signin')
          setError('Unable to detect Google account email.')
          return
        }

        const success = await login(emailFromSession, selectedRole)
        if (!success) {
          window.localStorage.removeItem('simmam_admin_google_signin')
          await adminSupabase.auth.signOut()
          setError('This Google account is not authorized for the selected admin role.')
          return
        }

        window.localStorage.removeItem('simmam_admin_google_signin')
        const storedUser = getStoredAdminUser()
        navigate({
          to: getAuthorizedAdminRedirect(storedUser, search.redirectTo),
          replace: true,
        })
      } catch (err: any) {
        window.localStorage.removeItem('simmam_admin_google_signin')
        setError(err?.message || 'Google sign-in failed. Please try again.')
      } finally {
        if (mounted) setAuthLoading(false)
      }
    }

    let authSubscription: { subscription: { unsubscribe: () => void } } | null = null

    const init = async () => {
      try {
        const { data: sessionData } = await adminSupabase.auth.getSession()
        if (sessionData?.session) {
          await handleSession(sessionData.session)
        }
      } catch {
        // ignore
      }

      const { data } = adminSupabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          void handleSession(session)
        }
      })
      authSubscription = data
    }

    void init()

    return () => {
      mounted = false
      try {
        authSubscription?.subscription.unsubscribe()
      } catch {
        // ignore unsubscribe errors
      }
    }
  }, [login, navigate, search.redirectTo])

  const handleGoogleSignIn = async () => {
    setError('')
    setAuthLoading(true)
    window.localStorage.setItem('simmam_admin_google_signin', '1')

    try {
      const { error: authError } = await adminSupabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getAppUrl('/wch1925/login'),
        },
      })
      if (authError) {
        window.localStorage.removeItem('simmam_admin_google_signin')
        setError(authError.message || 'Unable to start Google authentication.')
      }
    } catch (err: any) {
      window.localStorage.removeItem('simmam_admin_google_signin')
      setError(err?.message || 'Unable to start Google authentication.')
    } finally {
      setAuthLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-[#111] border border-[#333] rounded-xl p-8">
            <div className="text-center">
              <h1 className="font-display text-3xl font-bold text-white tracking-widest">
                SIMMAM
              </h1>
              <p className="mt-2 text-sm text-gray-400">
                Admin Control Center
              </p>
            </div>

            <div className="mt-8 space-y-6">
              <div className="space-y-3">
                <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                  <p className="font-semibold text-white">Admin access only</p>
                  <p className="mt-1 text-xs text-gray-400">Select the admin role and continue with Google authentication.</p>
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-gray-600 bg-[#222] p-3 text-sm text-white">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={authLoading}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:border-[#D4AF37]/30 hover:bg-[#D4AF37]/10 disabled:opacity-60"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
                  <path fill="#EA4335" d="M24 9.5c3.9 0 7.2 1.4 9.7 3.6l7.1-7.1C36.5 2.2 30.6 0 24 0 14.7 0 6.8 5.2 2.9 12.7l8.3 6.4C12.9 14.2 18.1 9.5 24 9.5z" />
                  <path fill="#34A853" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.6H24v9h12.7c-.6 3.2-2.6 5.8-5.5 7.6l8.4 6.5C43.5 39.1 46.5 32.4 46.5 24.5z" />
                  <path fill="#4A90E2" d="M10.3 29.1A14.9 14.9 0 0 1 9 24.5c0-1.6.3-3.1.8-4.6L2.9 13.6A24 24 0 0 0 0 24.5c0 3.8.9 7.3 2.9 10.6l7.4-6z" />
                  <path fill="#FBBC05" d="M24 48c6.6 0 12.5-2.2 17.2-6l-8.4-6.5c-2.6 1.8-5.9 2.8-8.8 2.8-5.9 0-11.1-4.7-12.8-11.1L2.9 35.3C6.8 42.7 14.7 48 24 48z" />
                </svg>
                {authLoading ? 'Signing in...' : 'Continue with Google'}
              </button>

              <div className="space-y-2">
                <Label htmlFor="admin-role">Admin Role</Label>
                <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as AdminRole)}>
                  <SelectTrigger id="admin-role">
                    <SelectValue placeholder="Choose admin role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Admin Role</SelectLabel>
                      <SelectItem value="developer_admin">Developer Admin</SelectItem>
                      <SelectItem value="core_team">Core Team</SelectItem>
                      <SelectItem value="reg_team">Registration Admin</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}