import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { PantryItem } from '../../shared/types'
import { ApiError } from '../lib/api'
import {
  addPantryItem,
  deletePantryItem,
  fetchPantry,
  locationLabel,
  PANTRY_LOCATIONS,
  type PantryLocation,
} from '../lib/pantry'

export function Pantry() {
  const [items, setItems] = useState<PantryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [location, setLocation] = useState<PantryLocation | ''>('cupboard')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await fetchPantry())
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load pantry',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const order = ['fridge', 'freezer', 'cupboard', 'other', ''] as const
    const map = new Map<string, PantryItem[]>()
    for (const item of items) {
      const key = item.location ?? ''
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return order
      .filter((key) => (map.get(key)?.length ?? 0) > 0)
      .map((key) => ({
        key,
        label: locationLabel(key || null),
        items: map.get(key)!,
      }))
  }, [items])

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    const displayName = name.trim()
    if (!displayName || busy) return

    setBusy(true)
    setError(null)
    try {
      let qty: number | null = null
      if (quantity.trim()) {
        const n = Number(quantity)
        if (!Number.isFinite(n) || n < 0) {
          setError('Quantity must be a non-negative number')
          setBusy(false)
          return
        }
        qty = n
      }
      const item = await addPantryItem({
        display_name: displayName,
        quantity: qty,
        unit: unit.trim() || null,
        location: location || null,
      })
      setItems((prev) =>
        [...prev, item].sort((a, b) =>
          a.display_name.localeCompare(b.display_name, undefined, {
            sensitivity: 'base',
          }),
        ),
      )
      setName('')
      setQuantity('')
      setUnit('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add item')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(item: PantryItem) {
    setBusy(true)
    setError(null)
    const prev = items
    setItems((list) => list.filter((i) => i.id !== item.id))
    try {
      await deletePantryItem(item.id)
    } catch (err) {
      setItems(prev)
      setError(
        err instanceof ApiError ? err.message : 'Could not remove item',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page page-pantry">
      <header className="page-header">
        <p className="page-kicker">Household</p>
        <h1 className="page-title">Pantry</h1>
        <p className="page-lede">
          Basics you usually have. Matching grocery items are marked “In pantry”
          when the list rebuilds — you can still undo and buy.
        </p>
        <p className="muted">
          <Link to="/groceries">← Groceries</Link>
          {' · '}
          <Link to="/settings">Settings</Link>
        </p>
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="pantry-add" onSubmit={onAdd}>
        <label className="auth-field" htmlFor="pantry-name">
          <span>Item</span>
          <input
            id="pantry-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Olive oil, eggs…"
            autoComplete="off"
            disabled={busy}
            required
          />
        </label>
        <div className="pantry-add-row">
          <label className="auth-field" htmlFor="pantry-qty">
            <span>Qty</span>
            <input
              id="pantry-qty"
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="—"
              disabled={busy}
            />
          </label>
          <label className="auth-field" htmlFor="pantry-unit">
            <span>Unit</span>
            <input
              id="pantry-unit"
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="bottle"
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label className="auth-field" htmlFor="pantry-loc">
            <span>Where</span>
            <select
              id="pantry-loc"
              value={location}
              onChange={(e) =>
                setLocation(e.target.value as PantryLocation | '')
              }
              disabled={busy}
            >
              {PANTRY_LOCATIONS.map((loc) => (
                <option key={loc.value} value={loc.value}>
                  {loc.label}
                </option>
              ))}
              <option value="">Unspecified</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !name.trim()}
        >
          Add to pantry
        </button>
      </form>

      <section className="page-section">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="empty-state">
            No pantry basics yet. Add staples you keep on hand.
          </p>
        ) : (
          <div className="pantry-list">
            {grouped.map((group) => (
              <section key={group.key || 'none'} className="aisle-group">
                <h2 className="aisle-heading">{group.label}</h2>
                <ul className="check-list pantry-items">
                  {group.items.map((item) => (
                    <li key={item.id} className="pantry-row">
                      <div className="pantry-row-body">
                        <span className="check-name">{item.display_name}</span>
                        {item.quantity != null || item.unit ? (
                          <span className="muted">
                            {[item.quantity, item.unit]
                              .filter((v) => v != null && v !== '')
                              .join(' ')}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void onRemove(item)}
                        disabled={busy}
                        aria-label={`Remove ${item.display_name}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
