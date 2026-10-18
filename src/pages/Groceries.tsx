import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { GroceryItemView, GroceryListDetail } from '../../shared/types'
import { WeekSwitcher } from '../components/WeekSwitcher'
import { ApiError } from '../lib/api'
import {
  addGroceryItem,
  fetchCurrentGroceryList,
  patchGroceryItem,
  regenerateGroceryList,
  sourceLabel,
} from '../lib/groceries'
import {
  cacheGroceryList,
  enqueueMutation,
  flushOfflineQueue,
  isNetworkError,
  markInFlight,
  mergeGroceryLists,
  newQueueId,
  newTempId,
  pendingItemIds,
  readCachedGroceryList,
} from '../lib/groceryOffline'
import {
  applyStreamEvent,
  subscribeGroceryStream,
  type GroceryStreamEvent,
} from '../lib/grocerySync'
import { formatWeekLabel } from '../lib/plans'
import {
  createSpeechRecognition,
  finalTranscriptFromEvent,
  interimTranscriptFromEvent,
  parseGroceryVoiceCommand,
  speechRecognitionSupported,
  type SpeechRecognitionLike,
} from '../lib/speechRecognition'
import { useSelectedWeek } from '../lib/weekSelection'

function findItemBySpokenName(
  name: string,
  items: GroceryItemView[],
): GroceryItemView | null {
  const needle = name.trim().toLowerCase()
  if (!needle) return null
  const unchecked = items.filter((i) => !i.checked_at && !i.already_have)
  const exact = unchecked.find((i) => i.display_name.toLowerCase() === needle)
  if (exact) return exact
  const partial = unchecked.filter(
    (i) =>
      i.display_name.toLowerCase().includes(needle) ||
      needle.includes(i.display_name.toLowerCase()),
  )
  return partial.length === 1 ? partial[0]! : null
}

export function Groceries() {
  const { weekStart, setWeekStart, thisWeek, nextWeek } = useSelectedWeek()
  const [list, setList] = useState<GroceryListDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [offlineQueued, setOfflineQueued] = useState(false)
  const [live, setLive] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const voiceSupported = useMemo(() => speechRecognitionSupported(), [])
  const listRef = useRef<GroceryListDetail | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const skipVoiceResultRef = useRef(false)
  listRef.current = list

  const applyList = useCallback(
    (next: GroceryListDetail | null) => {
      setList(next)
      if (next) cacheGroceryList(weekStart, next)
    },
    [weekStart],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setList(null)
    try {
      const next = await fetchCurrentGroceryList(weekStart)
      const merged = mergeGroceryLists(null, next, pendingItemIds())
      applyList(merged)
      setOfflineQueued(false)
    } catch (err) {
      const cached = readCachedGroceryList(weekStart)
      if (cached && isNetworkError(err)) {
        applyList(mergeGroceryLists(null, cached, pendingItemIds()))
        setOfflineQueued(true)
        setError('Offline — showing cached list')
      } else {
        setError(
          err instanceof ApiError ? err.message : 'Could not load grocery list',
        )
      }
    } finally {
      setLoading(false)
    }
  }, [weekStart, applyList])

  useEffect(() => {
    void load()
  }, [load])

  // SSE live updates while this page is open.
  useEffect(() => {
    const unsub = subscribeGroceryStream(weekStart, {
      onOpen: () => setLive(true),
      onError: () => setLive(false),
      onEvent: (event: GroceryStreamEvent) => {
        setList((prev) => {
          const pending = pendingItemIds()
          if (event.type === 'list') {
            const merged = mergeGroceryLists(prev, event.list, pending)
            cacheGroceryList(weekStart, merged)
            return merged
          }
          const next = applyStreamEvent(prev, event, pending)
          if (next) cacheGroceryList(weekStart, next)
          return next
        })
      },
    })
    return () => {
      setLive(false)
      unsub()
    }
  }, [weekStart])

  // Flush offline queue when back online.
  useEffect(() => {
    async function onOnline() {
      const result = await flushOfflineQueue(weekStart)
      if (result.flushed > 0) {
        setOfflineQueued(false)
        void load()
      }
      if (result.errors.length) {
        setError(result.errors[0]!)
      }
    }
    window.addEventListener('online', onOnline)
    if (navigator.onLine) void flushOfflineQueue(weekStart).then((r) => {
      if (r.flushed > 0) void load()
    })
    return () => window.removeEventListener('online', onOnline)
  }, [weekStart, load])

  const items = list?.items ?? []
  const aisleOrder = list?.aisle_order ?? []

  const grouped = useMemo(() => {
    const map = new Map<string, GroceryItemView[]>()
    for (const aisle of aisleOrder) map.set(aisle, [])
    for (const item of items) {
      const aisle = item.category?.trim() || 'Other'
      const bucket = map.get(aisle) ?? []
      bucket.push(item)
      map.set(aisle, bucket)
    }
    const known = aisleOrder
      .map((aisle) => ({ aisle, items: map.get(aisle) ?? [] }))
      .filter((g) => g.items.length > 0)
    const extras = [...map.entries()]
      .filter(([aisle]) => !aisleOrder.includes(aisle))
      .map(([aisle, groupItems]) => ({ aisle, items: groupItems }))
      .filter((g) => g.items.length > 0)
    return [...known, ...extras]
  }, [items, aisleOrder])

  const remaining = items.filter(
    (i) => !i.checked_at && !i.already_have,
  ).length

  function replaceItem(updated: GroceryItemView) {
    setList((prev) => {
      if (!prev) return prev
      const next = {
        ...prev,
        items: prev.items.map((i) => (i.id === updated.id ? updated : i)),
      }
      cacheGroceryList(weekStart, next)
      return next
    })
  }

  async function toggle(item: GroceryItemView) {
    const nextChecked = !item.checked_at
    const optimistic: GroceryItemView = {
      ...item,
      checked_at: nextChecked ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
      version: (item.version ?? 0) + 1,
    }
    replaceItem(optimistic)
    markInFlight(item.id, true)
    try {
      const saved = await patchGroceryItem(item.id, { checked: nextChecked })
      replaceItem(saved)
      setOfflineQueued(false)
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueMutation({
          id: newQueueId(),
          kind: 'patch',
          itemId: item.id,
          weekStart,
          body: {
            checked: nextChecked,
            base_version: item.version,
            base_updated_at: item.updated_at,
          },
          queued_at: new Date().toISOString(),
        })
        setOfflineQueued(true)
        setError(null)
      } else {
        replaceItem(item)
        setError(
          err instanceof ApiError ? err.message : 'Could not update item',
        )
      }
    } finally {
      markInFlight(item.id, false)
    }
  }

  async function markAlreadyHave(item: GroceryItemView) {
    const next = !item.already_have
    const optimistic: GroceryItemView = {
      ...item,
      already_have: next,
      source_type: next ? 'pantry_check' : item.manual ? 'manual' : 'recipe',
      checked_at: next ? item.checked_at ?? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
      version: (item.version ?? 0) + 1,
    }
    replaceItem(optimistic)
    markInFlight(item.id, true)
    try {
      const saved = await patchGroceryItem(item.id, { already_have: next })
      replaceItem(saved)
      setOfflineQueued(false)
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueMutation({
          id: newQueueId(),
          kind: 'patch',
          itemId: item.id,
          weekStart,
          body: {
            already_have: next,
            base_version: item.version,
            base_updated_at: item.updated_at,
          },
          queued_at: new Date().toISOString(),
        })
        setOfflineQueued(true)
        setError(null)
      } else {
        replaceItem(item)
        setError(
          err instanceof ApiError ? err.message : 'Could not update item',
        )
      }
    } finally {
      markInFlight(item.id, false)
    }
  }

  const addItemByName = useCallback(
    async (rawName: string) => {
      const name = rawName.trim()
      if (!name || busy) return
      setBusy(true)
      setError(null)
      setVoiceHint(null)
      const tempId = newTempId()
      const optimistic: GroceryItemView = {
        id: tempId,
        grocery_list_id: listRef.current?.id ?? '',
        ingredient_id: null,
        display_name: name,
        quantity: null,
        unit: null,
        category: 'Other',
        checked_at: null,
        source_type: 'manual',
        source_recipe_id: null,
        manual: true,
        notes: null,
        updated_at: new Date().toISOString(),
        version: 1,
        source_recipes: [],
        already_have: false,
        quantity_label: '',
      }
      setList((prev) =>
        prev
          ? (() => {
              const next = { ...prev, items: [...prev.items, optimistic] }
              cacheGroceryList(weekStart, next)
              return next
            })()
          : prev,
      )
      markInFlight(tempId, true)
      try {
        const item = await addGroceryItem({
          display_name: name,
          category: 'Other',
          week_start: weekStart,
        })
        setList((prev) => {
          if (!prev) return prev
          const next = {
            ...prev,
            items: prev.items.map((i) => (i.id === tempId ? item : i)),
          }
          cacheGroceryList(weekStart, next)
          return next
        })
        setDraft('')
        setOfflineQueued(false)
      } catch (err) {
        if (isNetworkError(err)) {
          enqueueMutation({
            id: newQueueId(),
            kind: 'add',
            weekStart,
            tempId,
            body: { display_name: name, category: 'Other' },
            queued_at: new Date().toISOString(),
          })
          setDraft('')
          setOfflineQueued(true)
        } else {
          setList((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              items: prev.items.filter((i) => i.id !== tempId),
            }
          })
          setError(
            err instanceof ApiError ? err.message : 'Could not add item',
          )
        }
      } finally {
        markInFlight(tempId, false)
        setBusy(false)
      }
    },
    [busy, weekStart],
  )

  async function onQuickAdd(e: FormEvent) {
    e.preventDefault()
    await addItemByName(draft)
  }

  function stopListening(opts?: { discard?: boolean }) {
    if (opts?.discard) skipVoiceResultRef.current = true
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
    setListening(false)
  }

  useEffect(() => {
    return () => {
      skipVoiceResultRef.current = true
      const rec = recognitionRef.current
      if (rec) {
        try {
          rec.abort()
        } catch {
          /* ignore */
        }
        recognitionRef.current = null
      }
    }
  }, [])

  function startListening() {
    if (!voiceSupported) {
      setVoiceHint('Voice not supported in this browser — type to add.')
      return
    }
    if (busy || listening) return

    const recognition = createSpeechRecognition()
    if (!recognition) {
      setVoiceHint('Voice not supported in this browser — type to add.')
      return
    }

    skipVoiceResultRef.current = false
    recognitionRef.current = recognition
    recognition.lang = navigator.language || 'en-US'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setListening(true)
      setVoiceHint('Listening…')
      setError(null)
    }

    recognition.onresult = (event) => {
      const interim = interimTranscriptFromEvent(event)
      if (interim) setDraft(interim)

      const finalText = finalTranscriptFromEvent(event)
      if (!finalText || skipVoiceResultRef.current) return

      const command = parseGroceryVoiceCommand(finalText)
      if (!command.name) {
        setVoiceHint('Didn’t catch that — try again.')
        return
      }

      if (command.kind === 'bought') {
        const match = findItemBySpokenName(
          command.name,
          listRef.current?.items ?? [],
        )
        if (match) {
          setDraft('')
          setVoiceHint(`Marked “${match.display_name}” bought`)
          void toggle(match)
        } else {
          setVoiceHint(`No match for “${command.name}” — type or try again.`)
        }
        return
      }

      setVoiceHint(null)
      void addItemByName(command.name)
    }

    recognition.onerror = (event) => {
      if (event.error === 'aborted') return
      if (event.error === 'not-allowed') {
        setVoiceHint('Microphone blocked — allow mic or type instead.')
      } else if (event.error === 'no-speech') {
        setVoiceHint('No speech heard — tap mic and try again.')
      } else {
        setVoiceHint('Voice failed — type to add instead.')
      }
      setListening(false)
    }

    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
      setVoiceHint((prev) => (prev === 'Listening…' ? null : prev))
    }

    try {
      recognition.start()
    } catch {
      setVoiceHint('Could not start voice — type to add instead.')
      recognitionRef.current = null
      setListening(false)
    }
  }

  function onMicClick() {
    if (listening) {
      stopListening({ discard: false })
      return
    }
    startListening()
  }

  async function onRegenerate() {
    setBusy(true)
    setError(null)
    try {
      const next = await regenerateGroceryList(weekStart)
      applyList(mergeGroceryLists(listRef.current, next, pendingItemIds()))
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not regenerate list',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page page-groceries">
      <header className="page-header">
        <p className="page-kicker">Shopping</p>
        <h1 className="page-title">Groceries</h1>
        <p className="page-lede">
          {loading
            ? 'Loading…'
            : `${remaining} left · ${formatWeekLabel(weekStart)}`}
          {live ? ' · live' : ''}
          {offlineQueued ? ' · queued offline' : ''}
        </p>
        <WeekSwitcher
          thisWeek={thisWeek}
          nextWeek={nextWeek}
          value={weekStart}
          onChange={setWeekStart}
          disabled={busy}
        />
        {list?.plan_status && list.plan_status !== 'approved' ? (
          <p className="muted">
            Approve this week&apos;s plan to auto-build from recipes.
          </p>
        ) : null}
        <div className="grocery-toolbar">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void onRegenerate()}
            disabled={busy || loading}
          >
            Rebuild from plan
          </button>
          <Link to="/pantry" className="btn btn-ghost btn-sm">
            Pantry
          </Link>
        </div>
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !list ? (
        <p className="muted">Loading grocery list…</p>
      ) : items.length === 0 ? (
        <p className="empty-state">
          No items yet. Approve a meal plan or quick-add something below.
        </p>
      ) : (
        <div className="grocery-list">
          {grouped.map((group) => (
            <section key={group.aisle} className="aisle-group">
              <h2 className="aisle-heading">{group.aisle}</h2>
              <ul className="check-list">
                {group.items.map((item) => {
                  const checked = Boolean(item.checked_at) || item.already_have
                  const open = expandedId === item.id
                  return (
                    <li key={item.id}>
                      <div className="check-row-wrap">
                        <label className="check-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => void toggle(item)}
                            className="check-input"
                          />
                          <span className="check-body">
                            <span
                              className={
                                checked ? 'check-name done' : 'check-name'
                              }
                            >
                              {item.display_name}
                              {item.quantity_label ? (
                                <span className="muted">
                                  {' '}
                                  · {item.quantity_label}
                                </span>
                              ) : item.notes?.toLowerCase() === 'in pantry' ? (
                                <span className="muted"> · in pantry</span>
                              ) : item.already_have ||
                                item.source_type === 'pantry_check' ? (
                                <span className="muted"> · check pantry</span>
                              ) : null}
                            </span>
                            <span className="check-source">
                              {sourceLabel(item)}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm check-detail-btn"
                          aria-expanded={open}
                          onClick={() =>
                            setExpandedId(open ? null : item.id)
                          }
                        >
                          {open ? 'Hide' : 'Details'}
                        </button>
                      </div>
                      {open ? (
                        <div className="grocery-item-detail">
                          {item.source_recipes.length > 0 ? (
                            <p>
                              <span className="muted">Needed for: </span>
                              {item.source_recipes
                                .map((r) => r.title)
                                .join(', ')}
                            </p>
                          ) : item.manual ? (
                            <p className="muted">Manual item</p>
                          ) : null}
                          <div className="grocery-item-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => void markAlreadyHave(item)}
                            >
                              {item.already_have
                                ? 'Need to buy'
                                : 'Already have'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <form className="quick-add" onSubmit={onQuickAdd}>
        <label className="sr-only" htmlFor="quick-add-input">
          Quick add grocery item
        </label>
        <input
          id="quick-add-input"
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            if (voiceHint) setVoiceHint(null)
          }}
          placeholder={listening ? 'Listening…' : 'Quick add…'}
          autoComplete="off"
          disabled={busy}
        />
        <button
          type="button"
          className={
            listening
              ? 'btn btn-secondary quick-add-mic is-listening'
              : 'btn btn-secondary quick-add-mic'
          }
          onClick={onMicClick}
          disabled={busy && !listening}
          aria-pressed={listening}
          aria-label={
            listening
              ? 'Stop voice input'
              : voiceSupported
                ? 'Add item by voice'
                : 'Voice input not supported'
          }
          title={
            voiceSupported
              ? listening
                ? 'Stop listening'
                : 'Speak an item to add'
              : 'Voice not supported in this browser'
          }
        >
          <svg
            className="quick-add-mic-icon"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            aria-hidden="true"
            focusable="false"
          >
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
            />
          </svg>
          <span className="sr-only">
            {listening ? 'Stop' : 'Voice'}
          </span>
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || !draft.trim() || listening}
        >
          Add
        </button>
      </form>
      {voiceHint ? (
        <p className="quick-add-voice-hint" role="status" aria-live="polite">
          {voiceHint}
        </p>
      ) : !voiceSupported ? (
        <p className="quick-add-voice-hint muted">
          Voice not available here — type to add items.
        </p>
      ) : null}
    </main>
  )
}
