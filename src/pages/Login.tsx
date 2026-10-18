import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import type { HouseholdWithMembers, PublicUser } from '../../shared/types'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../lib/auth'

export function Login() {
  const { user, household, loading, setSession } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) {
    return <Navigate to={household ? '/tonight' : '/household'} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await api<{
        user: PublicUser
        householdId: string | null
      }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })

      let nextHousehold: HouseholdWithMembers | null = null
      if (res.householdId) {
        const current = await api<{ household: HouseholdWithMembers | null }>(
          '/api/households/current',
        )
        nextHousehold = current.household
      }

      setSession(res.user, nextHousehold)
      navigate(nextHousehold ? '/tonight' : '/household', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <p className="brand">HomeLife</p>
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-lede">Recipe & grocery autopilot for your household.</p>

      <form className="auth-form" onSubmit={onSubmit}>
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth-footer">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </main>
  )
}
