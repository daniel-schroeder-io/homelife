import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { HouseholdWithMembers, PublicUser } from '../../shared/types'
import { api } from './api'

type AuthState = {
  user: PublicUser | null
  household: HouseholdWithMembers | null
  loading: boolean
  refresh: () => Promise<void>
  setSession: (
    user: PublicUser | null,
    household: HouseholdWithMembers | null,
  ) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [household, setHousehold] = useState<HouseholdWithMembers | null>(null)
  const [loading, setLoading] = useState(true)

  const setSession = useCallback(
    (nextUser: PublicUser | null, nextHousehold: HouseholdWithMembers | null) => {
      setUser(nextUser)
      setHousehold(nextHousehold)
    },
    [],
  )

  const refresh = useCallback(async () => {
    try {
      const me = await api<{
        user: PublicUser
        householdId: string | null
      }>('/api/auth/me')

      if (!me.householdId) {
        setSession(me.user, null)
        return
      }

      const { household: current } = await api<{
        household: HouseholdWithMembers | null
      }>('/api/households/current')
      setSession(me.user, current)
    } catch {
      setSession(null, null)
    }
  }, [setSession])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refresh()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } finally {
      setSession(null, null)
    }
  }, [setSession])

  return (
    <AuthContext.Provider
      value={{ user, household, loading, refresh, setSession, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
