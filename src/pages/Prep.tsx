import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PrepTaskView, PrepWeek } from '../../shared/types'
import { WeekSwitcher } from '../components/WeekSwitcher'
import { ApiError } from '../lib/api'
import { formatWeekLabel } from '../lib/plans'
import {
  deletePrepTask,
  effortLabel,
  fetchPrep,
  formatPrepWhen,
  generatePrep,
  patchPrepTask,
} from '../lib/prep'
import { subscribePlanStream } from '../lib/planSync'
import { useSelectedWeek } from '../lib/weekSelection'

export function Prep() {
  const { weekStart, setWeekStart, thisWeek, nextWeek } = useSelectedWeek()
  const [prep, setPrep] = useState<PrepWeek | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPrep(null)
    try {
      const next = await fetchPrep(weekStart)
      setPrep(next)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load prep tasks',
      )
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  const quietRefresh = useCallback(async () => {
    try {
      const next = await fetchPrep(weekStart)
      setPrep(next)
    } catch {
      /* keep current view on background sync failure */
    }
  }, [weekStart])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const unsub = subscribePlanStream(weekStart, {
      onEvent: (event) => {
        if (event.type === 'prep' || event.type === 'plan') void quietRefresh()
      },
    })
    return unsub
  }, [weekStart, quietRefresh])

  const tasks = prep?.tasks ?? []
  const open = tasks.filter((t) => t.status === 'pending').length

  function replaceTask(updated: PrepTaskView) {
    setPrep((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)),
      }
    })
  }

  async function toggle(task: PrepTaskView) {
    const nextStatus = task.status === 'done' ? 'pending' : 'done'
    // Optimistic
    replaceTask({ ...task, status: nextStatus })
    try {
      const updated = await patchPrepTask(task.id, { status: nextStatus })
      replaceTask(updated)
    } catch (err) {
      replaceTask(task)
      setError(
        err instanceof ApiError ? err.message : 'Could not update task',
      )
    }
  }

  async function runGenerate() {
    setBusy(true)
    setError(null)
    try {
      const next = await generatePrep(weekStart)
      setPrep(next)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not generate prep',
      )
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(task: PrepTaskView) {
    const title = editTitle.trim()
    if (!title) return
    setBusy(true)
    setError(null)
    try {
      const updated = await patchPrepTask(task.id, { title })
      replaceTask(updated)
      setEditingId(null)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not save title',
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeTask(task: PrepTaskView) {
    setError(null)
    if (editingId === task.id) setEditingId(null)
    setPrep((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== task.id),
      }
    })
    try {
      await deletePrepTask(task.id)
    } catch (err) {
      setPrep((prev) => {
        if (!prev) return prev
        if (prev.tasks.some((t) => t.id === task.id)) return prev
        return { ...prev, tasks: [...prev.tasks, task] }
      })
      setError(
        err instanceof ApiError ? err.message : 'Could not remove task',
      )
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <p className="page-kicker">Batch cooking</p>
        <h1 className="page-title">Prep</h1>
        <p className="page-lede">
          {loading && !prep
            ? 'Loading…'
            : `${open} open task${open === 1 ? '' : 's'} for ${formatWeekLabel(weekStart)}.`}
        </p>
        <WeekSwitcher
          thisWeek={thisWeek}
          nextWeek={nextWeek}
          value={weekStart}
          onChange={setWeekStart}
          disabled={busy}
        />
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="action-row prep-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || loading}
          onClick={() => void runGenerate()}
        >
          {busy ? 'Generating…' : tasks.length ? 'Regenerate' : 'Generate prep'}
        </button>
        {prep?.plan_id ? (
          <Link to="/plan" className="btn btn-ghost btn-sm">
            Open plan
          </Link>
        ) : null}
      </div>

      {loading && !prep ? (
        <p className="muted">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="muted">
          No prep tasks yet. Generate from this week&apos;s planned recipes to
          spot shared chops, grains, sauces, and marinades.
        </p>
      ) : (
        <ul className="check-list prep-list">
          {tasks.map((task) => {
            const done = task.status === 'done'
            const effort = effortLabel(task.effort)
            const linked =
              task.linked_recipes.map((r) => r.title).join(', ') || null
            return (
              <li key={task.id}>
                <div className="check-row-wrap">
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => void toggle(task)}
                      className="check-input"
                    />
                    <span className="check-body">
                      {editingId === task.id ? (
                        <span className="prep-edit-row">
                          <input
                            className="prep-edit-input"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            aria-label="Edit task title"
                          />
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={(e) => {
                              e.preventDefault()
                              void saveEdit(task)
                            }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.preventDefault()
                              setEditingId(null)
                            }}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className={done ? 'check-name done' : 'check-name'}>
                          {task.title}
                        </span>
                      )}
                      <span className="check-source">
                        {[
                          formatPrepWhen(task.scheduled_for),
                          task.duration_minutes != null
                            ? `${task.duration_minutes} min`
                            : null,
                          effort,
                          linked,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {task.notes ? (
                        <span className="check-source prep-notes">
                          {task.notes}
                        </span>
                      ) : null}
                    </span>
                  </label>
                  {editingId !== task.id ? (
                    <div className="prep-item-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setEditingId(task.id)
                          setEditTitle(task.title)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void removeTask(task)}
                        aria-label={`Remove ${task.title}`}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
