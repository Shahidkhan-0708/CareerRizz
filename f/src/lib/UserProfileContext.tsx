import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

export type ModuleName = 'outreach' | 'job_search'
export type WorkspaceName = 'outreach' | 'job_search'
export type UserRole = 'owner' | 'admin' | 'college_operator'

export interface UserProfile {
  role: UserRole
  enabled_modules: ModuleName[]
  active_workspace: WorkspaceName
}

interface UserProfileState {
  profile: UserProfile | null
  loading: boolean
  error: string | null
  switchWorkspace: (workspace: WorkspaceName) => Promise<void>
  hasModule: (module: ModuleName) => boolean
}

const UserProfileContext = createContext<UserProfileState | undefined>(undefined)

const supabaseConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

// Default profile when backend is unreachable — full access in dev, limited in prod.
const DEFAULT_PROFILE: UserProfile = supabaseConfigured
  ? { role: 'college_operator', enabled_modules: ['outreach'], active_workspace: 'outreach' }
  : { role: 'owner', enabled_modules: ['outreach', 'job_search'], active_workspace: 'outreach' }

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const { user, getAccessToken } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }

    try {
      const token = getAccessToken()
      const headers: Record<string, string> = {}
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      } else if (import.meta.env.DEV) {
        headers['x-bypass-auth'] = 'true'
      }

      const res = await fetch('/api/user/profile', { headers })

      if (!res.ok) {
        // Fallback: try the auth endpoint
        try {
          const fallback = await fetch('/auth/profile', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          if (fallback.ok) {
            const data = await fallback.json()
            setProfile(data.profile)
            setError(null)
          } else {
            setProfile(DEFAULT_PROFILE)
          }
        } catch {
          setProfile(DEFAULT_PROFILE)
        }
      } else {
        const data = await res.json()
        setProfile(data.profile)
        setError(null)
      }
    } catch (err) {
      console.warn('Failed to fetch user profile:', err)
      setProfile(DEFAULT_PROFILE)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [user, getAccessToken])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const switchWorkspace = useCallback(async (workspace: WorkspaceName) => {
    const token = getAccessToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    } else if (import.meta.env.DEV) {
      headers['x-bypass-auth'] = 'true'
    } else {
      return
    }

    try {
      const res = await fetch('/api/user/workspace', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ workspace }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to switch workspace')
      }

      setProfile(prev => prev ? { ...prev, active_workspace: workspace } : null)
    } catch (err) {
      setError((err as Error).message)
      throw err
    }
  }, [getAccessToken])

  const hasModule = useCallback((module: ModuleName): boolean => {
    if (!profile) return false
    if (profile.role === 'owner') return true
    return profile.enabled_modules.includes(module)
  }, [profile])

  return (
    <UserProfileContext.Provider value={{ profile, loading, error, switchWorkspace, hasModule }}>
      {children}
    </UserProfileContext.Provider>
  )
}

export function useUserProfile() {
  const ctx = useContext(UserProfileContext)
  if (!ctx) throw new Error('useUserProfile must be used within UserProfileProvider')
  return ctx
}
