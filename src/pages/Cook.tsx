import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { CookRating, RecipeDetail } from '../../shared/types'
import { ApiError, api } from '../lib/api'
import {
  COOK_RATING_LABELS,
  recordCookHistory,
} from '../lib/cookHistory'
import {
  formatTimerClock,
  parseTimerMinutes,
  splitInstructionSteps,
} from '../lib/cookMode'
import {
  formatIngredientLine,
  scaleQuantity,
} from '../lib/recipes'

type ActiveTimer = {
  id: string
  label: string
  totalSec: number
  remainingSec: number
  running: boolean
}

type WakeLockSentinelLike = {
  release: () => Promise<void>
  addEventListener?: (type: string, listener: () => void) => void
}

export function Cook() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const servingsParam = searchParams.get('servings')

  const [recipe, setRecipe] = useState<RecipeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [scaleServings, setScaleServings] = useState<number | null>(null)
  const [showIngredients, setShowIngredients] = useState(false)
  const [timers, setTimers] = useState<ActiveTimer[]>([])
  const [manualMinutes, setManualMinutes] = useState('10')
  const [doneOpen, setDoneOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [wakeSupported, setWakeSupported] = useState(false)
  const [wakeActive, setWakeActive] = useState(false)

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const tickRef = useRef<number | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    // Always load base recipe; scale quantities client-side so changing
    // servings mid-cook does not double-apply server scale.
    api<{ recipe: RecipeDetail }>(`/api/recipes/${id}`)
      .then((res) => {
        if (cancelled) return
        setRecipe(res.recipe)
        const fromQuery =
          servingsParam && Number(servingsParam) > 0
            ? Number(servingsParam)
            : null
        setScaleServings(fromQuery ?? res.recipe.servings)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Could not load recipe',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, servingsParam])

  // Wake Lock — keep screen awake while cooking when supported.
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }
    if (!nav.wakeLock?.request) {
      setWakeSupported(false)
      return
    }
    setWakeSupported(true)

    let cancelled = false

    async function requestLock() {
      try {
        const lock = await nav.wakeLock!.request('screen')
        if (cancelled) {
          void lock.release()
          return
        }
        wakeLockRef.current = lock
        setWakeActive(true)
        lock.addEventListener?.('release', () => {
          setWakeActive(false)
        })
      } catch {
        setWakeActive(false)
      }
    }

    void requestLock()

    function onVisibility() {
      if (document.visibilityState === 'visible') void requestLock()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      const lock = wakeLockRef.current
      wakeLockRef.current = null
      if (lock) void lock.release()
      setWakeActive(false)
    }
  }, [])

  // Timer tick
  useEffect(() => {
    const hasRunning = timers.some((t) => t.running && t.remainingSec > 0)
    if (!hasRunning) {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current)
        tickRef.current = null
      }
      return
    }
    tickRef.current = window.setInterval(() => {
      setTimers((prev) =>
        prev.map((t) => {
          if (!t.running || t.remainingSec <= 0) return t
          const next = t.remainingSec - 1
          return {
            ...t,
            remainingSec: next,
            running: next > 0 ? t.running : false,
          }
        }),
      )
    }, 1000)
    return () => {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [timers])

  const steps = useMemo(
    () => splitInstructionSteps(recipe?.instructions ?? null),
    [recipe],
  )

  const currentStep = steps[stepIndex] ?? ''
  const stepTimers = useMemo(
    () => parseTimerMinutes(currentStep),
    [currentStep],
  )

  const scaledIngredients = useMemo(() => {
    if (!recipe) return []
    const base = recipe.servings
    const target = scaleServings ?? base ?? 1
    return recipe.ingredients.map((ing) => ({
      ...ing,
      scaled: scaleQuantity(ing.quantity, base, target),
    }))
  }, [recipe, scaleServings])

  function addTimer(minutes: number, label?: string) {
    const totalSec = Math.round(minutes * 60)
    if (totalSec <= 0) return
    setTimers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: label ?? `${minutes} min`,
        totalSec,
        remainingSec: totalSec,
        running: true,
      },
    ])
  }

  async function finish(rating: CookRating | null) {
    if (!recipe) return
    setSaving(true)
    setError(null)
    try {
      await recordCookHistory({
        recipe_id: recipe.id,
        rating,
        feedback: null,
      })
      setSaved(true)
      setDoneOpen(false)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not save cook history',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="page cook-page">
        <p className="muted">Loading cook mode…</p>
      </main>
    )
  }

  if (!recipe) {
    return (
      <main className="page cook-page">
        <p className="auth-error" role="alert">
          {error ?? 'Recipe not found'}
        </p>
        <Link to="/tonight" className="btn btn-secondary">
          Back to Tonight
        </Link>
      </main>
    )
  }

  const atStart = stepIndex <= 0
  const atEnd = steps.length === 0 || stepIndex >= steps.length - 1

  return (
    <main className="page cook-page">
      <header className="cook-header">
        <Link to={`/recipes/${recipe.id}`} className="cook-exit">
          Exit
        </Link>
        <h1 className="cook-title">{recipe.title}</h1>
        <p className="cook-meta">
          {steps.length > 0
            ? `Step ${Math.min(stepIndex + 1, steps.length)} of ${steps.length}`
            : 'No steps'}
          {wakeSupported ? (
            <span className="cook-wake">
              {wakeActive ? ' · Screen awake' : ' · Wake lock off'}
            </span>
          ) : null}
        </p>
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {saved ? (
        <p className="cook-saved" role="status">
          Saved to cook history.
          <Link to="/tonight"> Back to Tonight</Link>
        </p>
      ) : null}

      <section className="cook-scale" aria-label="Servings">
        <label className="cook-scale-label">
          <span>Servings</span>
          <input
            type="number"
            min={1}
            step={1}
            className="cook-scale-input"
            value={scaleServings ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              setScaleServings(Number.isFinite(n) && n > 0 ? n : null)
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary cook-ing-toggle"
          onClick={() => setShowIngredients((v) => !v)}
        >
          {showIngredients ? 'Hide ingredients' : 'Ingredients'}
        </button>
      </section>

      {showIngredients ? (
        <ul className="cook-ingredients">
          {scaledIngredients.map((ing) => (
            <li key={ing.id}>{formatIngredientLine(ing, ing.scaled)}</li>
          ))}
          {scaledIngredients.length === 0 ? (
            <li className="muted">No ingredients listed.</li>
          ) : null}
        </ul>
      ) : null}

      <section className="cook-step" aria-live="polite">
        {steps.length === 0 ? (
          <p className="cook-step-text muted">
            No instructions yet. Add steps on the recipe page.
          </p>
        ) : (
          <p className="cook-step-text">{currentStep}</p>
        )}
      </section>

      <div className="cook-nav">
        <button
          type="button"
          className="btn btn-secondary cook-nav-btn"
          disabled={atStart}
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-primary cook-nav-btn"
          disabled={atEnd || steps.length === 0}
          onClick={() =>
            setStepIndex((i) => Math.min(steps.length - 1, i + 1))
          }
        >
          Next
        </button>
      </div>

      <section className="cook-timers" aria-label="Timers">
        <h2 className="cook-section-label">Timers</h2>
        {stepTimers.length > 0 ? (
          <div className="cook-timer-suggest">
            {stepTimers.map((m) => (
              <button
                key={m}
                type="button"
                className="btn btn-secondary cook-timer-chip"
                onClick={() => addTimer(m, `${m} min · step`)}
              >
                {m} min
              </button>
            ))}
          </div>
        ) : null}
        <div className="cook-timer-manual">
          <input
            type="number"
            min={1}
            max={180}
            className="cook-scale-input"
            value={manualMinutes}
            onChange={(e) => setManualMinutes(e.target.value)}
            aria-label="Manual timer minutes"
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const n = Number(manualMinutes)
              if (Number.isFinite(n) && n > 0) addTimer(n)
            }}
          >
            Start timer
          </button>
        </div>
        {timers.length > 0 ? (
          <ul className="cook-timer-list">
            {timers.map((t) => (
              <li
                key={t.id}
                className={
                  t.remainingSec <= 0
                    ? 'cook-timer-row done'
                    : 'cook-timer-row'
                }
              >
                <span className="cook-timer-clock">
                  {formatTimerClock(t.remainingSec)}
                </span>
                <span className="cook-timer-label">{t.label}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setTimers((prev) =>
                      prev.map((x) =>
                        x.id === t.id
                          ? { ...x, running: !x.running && x.remainingSec > 0 }
                          : x,
                      ),
                    )
                  }
                  disabled={t.remainingSec <= 0}
                >
                  {t.running ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setTimers((prev) => prev.filter((x) => x.id !== t.id))
                  }
                >
                  Clear
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="cook-finish">
        {!doneOpen ? (
          <button
            type="button"
            className="btn btn-primary cook-finish-btn"
            disabled={saving || saved}
            onClick={() => setDoneOpen(true)}
          >
            Cooked it
          </button>
        ) : (
          <div className="cook-rating">
            <p className="cook-rating-prompt">How was it?</p>
            <div className="cook-rating-row">
              {(Object.keys(COOK_RATING_LABELS) as CookRating[]).map(
                (rating) => (
                  <button
                    key={rating}
                    type="button"
                    className="btn btn-secondary cook-rating-btn"
                    disabled={saving}
                    onClick={() => void finish(rating)}
                  >
                    {COOK_RATING_LABELS[rating]}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => void finish(null)}
            >
              Skip rating
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDoneOpen(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
