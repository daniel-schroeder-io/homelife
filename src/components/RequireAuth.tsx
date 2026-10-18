import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

/** Gates product routes: login → household onboarding → app. */
export function RequireAuth() {
  const { user, household, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="auth-gate">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!household) {
    return <Navigate to="/household" replace />
  }

  return <Outlet />
}
