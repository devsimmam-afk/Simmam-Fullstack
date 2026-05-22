import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { AdminUser, AdminRole } from '@/types/admin'
import { ROLE_PERMISSIONS, ROUTE_PERMISSIONS } from '@/types/admin'
import adminSupabase from '@/lib/adminSupabase'
import { getAdminApiBase } from '@/lib/adminApi'

interface AuthContextType {
  user: AdminUser | null
  login: (email: string, role: AdminRole) => Promise<boolean>
  logout: () => void
  hasPermission: (resource: string, action: string) => boolean
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function getStoredAdminUser(): AdminUser | null {
  if (typeof window === 'undefined') return null

  const storedUser = localStorage.getItem('simmam_admin_user')
  if (!storedUser) return null

  try {
    const parsed = JSON.parse(storedUser)
    if (parsed?.role === 'coordinator') {
      localStorage.removeItem('simmam_admin_user')
      return null
    }

    return parsed as AdminUser
  } catch {
    localStorage.removeItem('simmam_admin_user')
    return null
  }
}

export function canAccessAdminPath(user: AdminUser | null | undefined, pathname: string): boolean {
  if (!user) return false

  const permissions = ROLE_PERMISSIONS[user.role] || []

  if (pathname === '/wch1925' || pathname === '/wch1925/') {
    return user.role === 'developer_admin' || user.role === 'core_team' || user.role === 'reg_team'
  }

  const normalizedPath = pathname.replace(/\/$/, '')
  const allowed = Object.entries(ROUTE_PERMISSIONS || {})
  return allowed.some(([routePath, requiredPermissions]) => {
    if (routePath !== normalizedPath) return false
    return requiredPermissions.every((permission) =>
      permissions.some((entry) => entry.resource === permission.resource && permission.actions.every((action) => entry.actions.includes(action))),
    )
  })
}

export function getDefaultAdminPath(user: AdminUser | null | undefined): string {
  if (!user) return '/wch1925'
  if (user.role === 'reg_team') return '/wch1925/checkin'
  return '/wch1925'
}

export function getAuthorizedAdminRedirect(user: AdminUser | null | undefined, requestedPath?: string | null): string {
  if (requestedPath && canAccessAdminPath(user, requestedPath)) {
    return requestedPath
  }

  return getDefaultAdminPath(user)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check for stored auth on mount
    const storedUser = getStoredAdminUser()
    if (storedUser) setUser(storedUser)
    setIsLoading(false)
  }, [])

  const login = async (email: string, role: AdminRole): Promise<boolean> => {
    const normalizedEmail = String(email ?? '').trim().toLowerCase()
    if (!normalizedEmail || !role) return false

    try {
      const { data: sessionData } = await adminSupabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return false

      const response = await fetch(getAdminApiBase('/auth'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: normalizedEmail, role }),
      })

      if (!response.ok) {
        return false
      }

      const result = await response.json()
      const adminUser = result?.user as AdminUser | undefined
      if (!adminUser?.email || !adminUser?.role) {
        return false
      }

      setUser(adminUser)
      localStorage.setItem('simmam_admin_user', JSON.stringify(adminUser))
      return true
    } catch {
      return false
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('simmam_admin_user')
    localStorage.removeItem('simmam_admin_google_signin')
    void adminSupabase.auth.signOut().catch(() => {
      // ignore cleanup failures
    })
  }

  const hasPermission = (resource: string, action: string): boolean => {
    if (!user) return false

    const permissions = ROLE_PERMISSIONS[user.role] || []

    return permissions.some(perm =>
      perm.resource === resource && perm.actions.includes(action)
    )
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, hasPermission, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    // Fallback for unexpected render sequences (eg. rapid logout + route redirect)
    // Returning a safe default prevents a thrown error during render which
    // can lead React to detect a "rendered fewer hooks than expected" mismatch.
    return {
      user: null,
      login: async () => false,
      logout: () => {},
      hasPermission: () => false,
      isLoading: true,
    } as unknown as AuthContextType
  }

  return context
}
