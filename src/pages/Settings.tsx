import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  deleteAccount,
  deleteHousehold,
  downloadExport,
  fetchPreferences,
  patchPreferences,
  type HouseholdPreferences,
} from '../lib/preferences'

const emptyPrefs: HouseholdPreferences = {
  cooked_dinners_per_week: 5,
  max_active_minutes: null,
  busy_day_threshold_minutes: 40,
  default_servings: 4,
  cuisine_notes: '',
  avoid_notes: '',
  allergies: [],
}

export function Settings() {
  const { household, setSession, logout } = useAuth()
  const navigate = useNavigate()

  const [prefs, setPrefs] = useState<HouseholdPreferences>(emptyPrefs)
  const [allergiesText, setAllergiesText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)

  const [exportBusy, setExportBusy] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchPreferences()
      setPrefs(next)
      setAllergiesText(next.allergies.join(', '))
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load preferences',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSavedMsg(null)
    try {
      const allergies = allergiesText
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const next = await patchPreferences({
        cooked_dinners_per_week: prefs.cooked_dinners_per_week,
        max_active_minutes: prefs.max_active_minutes,
        busy_day_threshold_minutes: prefs.busy_day_threshold_minutes,
        default_servings: prefs.default_servings,
        cuisine_notes: prefs.cuisine_notes,
        avoid_notes: prefs.avoid_notes,
        allergies,
      })
      setPrefs(next)
      setAllergiesText(next.allergies.join(', '))
      setSavedMsg('Preferences saved — new drafts will use them.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function onInvite() {
    setInviteBusy(true)
    setError(null)
    try {
      const res = await api<{ invite: { code: string } }>(
        '/api/households/invite',
        { method: 'POST' },
      )
      setInviteCode(res.invite.code)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not create invite',
      )
    } finally {
      setInviteBusy(false)
    }
  }

  async function onExport() {
    setExportBusy(true)
    setError(null)
    try {
      await downloadExport()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExportBusy(false)
    }
  }

  async function onDeleteHousehold() {
    if (!household) return
    setDeleteBusy(true)
    setError(null)
    try {
      await deleteHousehold(deleteConfirm)
      setSession(null, null)
      navigate('/login', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not delete household',
      )
    } finally {
      setDeleteBusy(false)
    }
  }

  async function onDeleteAccount() {
    setAccountBusy(true)
    setError(null)
    try {
      await deleteAccount()
      setSession(null, null)
      navigate('/register', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not delete account',
      )
    } finally {
      setAccountBusy(false)
    }
  }

  const solo =
    household != null && (household.members?.length ?? 0) <= 1

  return (
    <main className="page page-settings">
      <header className="page-header">
        <p className="page-kicker">Household</p>
        <h1 className="page-title">Settings</h1>
        <p className="page-lede">
          Planning preferences, invite, export, and account controls.
        </p>
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      {savedMsg ? (
        <p className="settings-success" role="status">
          {savedMsg}
        </p>
      ) : null}

      <section className="page-section settings-install">
        <h2 className="section-title">Install on your phone</h2>
        <p className="muted">
          Add HomeLife to your home screen for a full-screen app with the bottom
          tabs and offline grocery check-offs.
        </p>
        <ul className="settings-install-steps">
          <li>
            <strong>iPhone:</strong> Safari → Share → Add to Home Screen
          </li>
          <li>
            <strong>Android:</strong> Chrome → menu → Install app / Add to Home
            screen
          </li>
        </ul>
        <div className="action-row compact">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>
      </section>

      <section className="page-section">
        <h2 className="section-title">Planning preferences</h2>
        <p className="muted">
          Used when generating a weekly draft. Allergies hard-exclude matching
          recipes (simple name/tag match — not medical-grade).
        </p>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <form className="settings-form" onSubmit={onSave}>
            <div className="recipe-form-row">
              <label className="auth-field" htmlFor="pref-cooked">
                <span>Cooked dinners / week</span>
                <input
                  id="pref-cooked"
                  type="number"
                  min={1}
                  max={7}
                  value={prefs.cooked_dinners_per_week}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      cooked_dinners_per_week: Number(e.target.value) || 1,
                    })
                  }
                />
              </label>
              <label className="auth-field" htmlFor="pref-max">
                <span>Max active minutes</span>
                <input
                  id="pref-max"
                  type="number"
                  min={5}
                  max={240}
                  placeholder="No limit"
                  value={prefs.max_active_minutes ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setPrefs({
                      ...prefs,
                      max_active_minutes: v === '' ? null : Number(v),
                    })
                  }}
                />
              </label>
            </div>

            <div className="recipe-form-row">
              <label className="auth-field" htmlFor="pref-busy">
                <span>Busy-day threshold (min)</span>
                <input
                  id="pref-busy"
                  type="number"
                  min={15}
                  max={180}
                  value={prefs.busy_day_threshold_minutes}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      busy_day_threshold_minutes: Number(e.target.value) || 40,
                    })
                  }
                />
              </label>
              <label className="auth-field" htmlFor="pref-servings">
                <span>Default servings</span>
                <input
                  id="pref-servings"
                  type="number"
                  min={1}
                  max={24}
                  value={prefs.default_servings}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      default_servings: Number(e.target.value) || 4,
                    })
                  }
                />
              </label>
            </div>

            <label className="auth-field" htmlFor="pref-cuisine">
              <span>Cuisine notes</span>
              <textarea
                id="pref-cuisine"
                className="recipe-textarea"
                rows={2}
                placeholder="e.g. Mexican, Korean, sheet-pan favorites"
                value={prefs.cuisine_notes}
                onChange={(e) =>
                  setPrefs({ ...prefs, cuisine_notes: e.target.value })
                }
              />
            </label>

            <label className="auth-field" htmlFor="pref-avoid">
              <span>Avoid notes</span>
              <textarea
                id="pref-avoid"
                className="recipe-textarea"
                rows={2}
                placeholder="e.g. no seafood this month, skip mushrooms"
                value={prefs.avoid_notes}
                onChange={(e) =>
                  setPrefs({ ...prefs, avoid_notes: e.target.value })
                }
              />
            </label>

            <label className="auth-field" htmlFor="pref-allergies">
              <span>Allergies (comma-separated)</span>
              <input
                id="pref-allergies"
                type="text"
                placeholder="e.g. peanut, shellfish, dairy"
                value={allergiesText}
                onChange={(e) => setAllergiesText(e.target.value)}
              />
            </label>

            <div className="action-row compact">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save preferences'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="page-section">
        <h2 className="section-title">Pantry basics</h2>
        <p className="muted">
          Shared staples (fridge, freezer, cupboard). Matching grocery lines are
          pre-marked “In pantry” when the list rebuilds.
        </p>
        <div className="action-row compact">
          <Link to="/pantry" className="btn btn-secondary">
            Open pantry
          </Link>
        </div>
      </section>

      <section className="page-section">
        <h2 className="section-title">Invite partner</h2>
        <p className="muted">
          Share a one-time code so your partner can join this household.
        </p>
        {inviteCode ? (
          <p className="invite-code" aria-live="polite">
            {inviteCode}
          </p>
        ) : null}
        <div className="action-row compact">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={inviteBusy}
            onClick={() => void onInvite()}
          >
            {inviteBusy ? 'Creating…' : inviteCode ? 'New invite code' : 'Get invite code'}
          </button>
        </div>
      </section>

      <section className="page-section">
        <h2 className="section-title">Export data</h2>
        <p className="muted">
          Download a JSON dump of recipes, plans, groceries, pantry, prep,
          history, and preferences.
        </p>
        <div className="action-row compact">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={exportBusy}
            onClick={() => void onExport()}
          >
            {exportBusy ? 'Preparing…' : 'Download JSON export'}
          </button>
        </div>
      </section>

      <section className="page-section settings-danger">
        <h2 className="section-title">Danger zone</h2>
        <p className="muted">
          Deleting the household permanently wipes recipes, plans, groceries,
          prep, and history. Type the household name to confirm.
        </p>
        <label className="auth-field" htmlFor="delete-confirm">
          <span>
            Confirm by typing{' '}
            <strong>{household?.name ?? 'household name'}</strong>
          </span>
          <input
            id="delete-confirm"
            type="text"
            autoComplete="off"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={household?.name}
          />
        </label>
        <div className="action-row compact">
          <button
            type="button"
            className="btn btn-danger"
            disabled={
              deleteBusy ||
              !household ||
              deleteConfirm.trim() !== household.name
            }
            onClick={() => void onDeleteHousehold()}
          >
            {deleteBusy ? 'Deleting…' : 'Delete household'}
          </button>
        </div>

        {solo ? (
          <>
            <p className="muted settings-danger-gap">
              Or delete your account entirely (solo households only).
            </p>
            <div className="action-row compact">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={accountBusy}
                onClick={() => void onDeleteAccount()}
              >
                {accountBusy ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </>
        ) : null}

      </section>
    </main>
  )
}
