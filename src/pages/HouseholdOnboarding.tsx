import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type { HouseholdWithMembers } from '../../shared/types'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../lib/auth'

export function HouseholdOnboarding() {
  const { user, household, loading, setSession, logout } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <main className="auth-page">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Already in a household — show invite + continue (useful after create).
  if (household && !inviteCode) {
    return (
      <main className="auth-page">
        <p className="brand">HomeLife</p>
        <h1 className="auth-title">{household.name}</h1>
        <p className="auth-lede">
          You&apos;re in. Invite your partner with a shareable code, or continue
          to the app.
        </p>
        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/tonight')}
          >
            Continue
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={submitting}
            onClick={async () => {
              setError(null)
              setSubmitting(true)
              try {
                const res = await api<{
                  invite: { code: string }
                }>('/api/households/invite', { method: 'POST' })
                setInviteCode(res.invite.code)
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : 'Could not create invite',
                )
              } finally {
                setSubmitting(false)
              }
            }}
          >
            Get invite code
          </button>
        </div>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="auth-footer">
          <button type="button" className="btn btn-ghost" onClick={() => logout()}>
            Sign out
          </button>
        </p>
      </main>
    )
  }

  if (household && inviteCode) {
    return (
      <main className="auth-page">
        <p className="brand">HomeLife</p>
        <h1 className="auth-title">Invite code</h1>
        <p className="auth-lede">
          Share this code with your partner. They sign up, then join with it.
        </p>
        <p className="invite-code" aria-live="polite">
          {inviteCode}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate('/tonight')}
        >
          Continue to app
        </button>
      </main>
    )
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await api<{ household: HouseholdWithMembers }>(
        '/api/households',
        { method: 'POST', body: { name } },
      )
      setSession(user, res.household)

      const invite = await api<{ invite: { code: string } }>(
        '/api/households/invite',
        { method: 'POST' },
      )
      setInviteCode(invite.invite.code)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create household')
    } finally {
      setSubmitting(false)
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await api<{ household: HouseholdWithMembers }>(
        '/api/households/accept',
        { method: 'POST', body: { code } },
      )
      setSession(user, res.household)
      navigate('/tonight', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join household')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <p className="brand">HomeLife</p>
      <h1 className="auth-title">Your household</h1>
      <p className="auth-lede">
        Hi {user.name} — create a household or join with a partner&apos;s invite
        code.
      </p>

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'create'}
          className={mode === 'create' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => {
            setMode('create')
            setError(null)
          }}
        >
          Create
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'join'}
          className={mode === 'join' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => {
            setMode('join')
            setError(null)
          }}
        >
          Join
        </button>
      </div>

      {mode === 'create' ? (
        <form className="auth-form" onSubmit={onCreate}>
          <label className="auth-field">
            <span>Household name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Schro kitchen"
            />
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create household'}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={onJoin}>
          <label className="auth-field">
            <span>Invite code</span>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              autoCapitalize="characters"
            />
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Joining…' : 'Join household'}
          </button>
        </form>
      )}

      <p className="auth-footer">
        <button type="button" className="btn btn-ghost" onClick={() => logout()}>
          Sign out
        </button>
      </p>
    </main>
  )
}
