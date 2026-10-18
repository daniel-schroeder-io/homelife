import type { GroceryItemView, GroceryListDetail } from '../../shared/types'
import { api, ApiError } from './api'

const QUEUE_KEY = 'homelife.grocery.queue.v1'
const CACHE_KEY = 'homelife.grocery.cache.v1'
const PENDING_KEY = 'homelife.grocery.pending.v1'

export type GroceryPatchBody = {
  display_name?: string
  quantity?: number | null
  unit?: string | null
  category?: string | null
  checked?: boolean
  checked_at?: string | null
  already_have?: boolean
  notes?: string | null
  /** Client hint for conflict merge when flushing. */
  base_version?: number
  base_updated_at?: string
}

export type QueuedMutation =
  | {
      id: string
      kind: 'patch'
      itemId: string
      weekStart: string
      body: GroceryPatchBody
      queued_at: string
    }
  | {
      id: string
      kind: 'add'
      weekStart: string
      tempId: string
      body: {
        display_name: string
        quantity?: number | null
        unit?: string | null
        category?: string
        notes?: string | null
      }
      queued_at: string
    }
  | {
      id: string
      kind: 'delete'
      itemId: string
      weekStart: string
      queued_at: string
    }

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (err instanceof ApiError && err.status === 0) return true
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('load failed') ||
      msg.includes('network request failed')
    )
  }
  return false
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadOfflineQueue(): QueuedMutation[] {
  return readJson<QueuedMutation[]>(QUEUE_KEY, [])
}

export function saveOfflineQueue(queue: QueuedMutation[]): void {
  writeJson(QUEUE_KEY, queue)
}

export function enqueueMutation(mutation: QueuedMutation): void {
  const queue = loadOfflineQueue()
  // Coalesce patches for the same item into the latest queued body.
  if (mutation.kind === 'patch') {
    const idx = queue.findIndex(
      (m) => m.kind === 'patch' && m.itemId === mutation.itemId,
    )
    if (idx >= 0) {
      const prev = queue[idx]! as Extract<QueuedMutation, { kind: 'patch' }>
      queue[idx] = {
        ...mutation,
        body: { ...prev.body, ...mutation.body },
      }
      saveOfflineQueue(queue)
      return
    }
  }
  queue.push(mutation)
  saveOfflineQueue(queue)
}

export function pendingItemIds(): Set<string> {
  const fromQueue = loadOfflineQueue().flatMap((m) => {
    if (m.kind === 'patch' || m.kind === 'delete') return [m.itemId]
    if (m.kind === 'add') return [m.tempId]
    return []
  })
  const inFlight = readJson<string[]>(PENDING_KEY, [])
  return new Set([...fromQueue, ...inFlight])
}

export function markInFlight(itemId: string | null, on: boolean): void {
  const cur = new Set(readJson<string[]>(PENDING_KEY, []))
  if (!itemId) return
  if (on) cur.add(itemId)
  else cur.delete(itemId)
  writeJson(PENDING_KEY, [...cur])
}

export function cacheGroceryList(
  weekStart: string,
  list: GroceryListDetail,
): void {
  const all = readJson<Record<string, GroceryListDetail>>(CACHE_KEY, {})
  all[weekStart] = list
  writeJson(CACHE_KEY, all)
}

export function readCachedGroceryList(
  weekStart: string,
): GroceryListDetail | null {
  const all = readJson<Record<string, GroceryListDetail>>(CACHE_KEY, {})
  return all[weekStart] ?? null
}

export function itemIsNewer(
  a: Pick<GroceryItemView, 'version' | 'updated_at'>,
  b: Pick<GroceryItemView, 'version' | 'updated_at'>,
): boolean {
  if ((a.version ?? 0) !== (b.version ?? 0)) {
    return (a.version ?? 0) > (b.version ?? 0)
  }
  return (a.updated_at ?? '') > (b.updated_at ?? '')
}

/**
 * Merge remote list into local without wiping in-flight / queued item edits.
 * Independent items take the newer version; pending local items keep local fields.
 */
export function mergeGroceryLists(
  local: GroceryListDetail | null,
  remote: GroceryListDetail,
  pendingIds: Set<string>,
): GroceryListDetail {
  if (!local) return remote

  const localById = new Map(local.items.map((i) => [i.id, i]))
  const merged: GroceryItemView[] = []
  const seen = new Set<string>()

  for (const remoteItem of remote.items) {
    seen.add(remoteItem.id)
    const localItem = localById.get(remoteItem.id)
    if (!localItem) {
      merged.push(remoteItem)
      continue
    }
    if (pendingIds.has(remoteItem.id)) {
      // Keep local optimistic fields; adopt newer server metadata if present.
      if (itemIsNewer(remoteItem, localItem)) {
        merged.push({
          ...localItem,
          // Server won on unrelated provenance/qty when its version is ahead,
          // but preserve the pending check / already_have intent from local.
          quantity: remoteItem.quantity,
          unit: remoteItem.unit,
          category: remoteItem.category,
          display_name: remoteItem.display_name,
          source_recipes: remoteItem.source_recipes,
          quantity_label: remoteItem.quantity_label,
          version: Math.max(localItem.version ?? 0, remoteItem.version ?? 0),
          updated_at:
            localItem.updated_at > remoteItem.updated_at
              ? localItem.updated_at
              : remoteItem.updated_at,
        })
      } else {
        merged.push(localItem)
      }
      continue
    }
    merged.push(itemIsNewer(remoteItem, localItem) ? remoteItem : localItem)
  }

  // Keep offline-added temp items (and any local-only pending rows).
  for (const localItem of local.items) {
    if (seen.has(localItem.id)) continue
    if (pendingIds.has(localItem.id) || localItem.id.startsWith('tmp_')) {
      merged.push(localItem)
    }
  }

  return {
    ...remote,
    items: merged,
  }
}

export function newTempId(): string {
  return `tmp_${crypto.randomUUID()}`
}

export function newQueueId(): string {
  return crypto.randomUUID()
}

let flushing = false

/**
 * Flush queued mutations. Per-item: if server responds with a newer version
 * for fields we did not patch, keep server values (response already is the merge).
 */
export async function flushOfflineQueue(
  weekStart?: string,
): Promise<{ flushed: number; errors: string[] }> {
  if (flushing) return { flushed: 0, errors: [] }
  if (!navigator.onLine) return { flushed: 0, errors: [] }

  flushing = true
  const errors: string[] = []
  let flushed = 0

  try {
    let queue = loadOfflineQueue()
    if (weekStart) {
      queue = queue.filter((m) => m.weekStart === weekStart)
    }
    const remaining = loadOfflineQueue().filter(
      (m) => !queue.some((q) => q.id === m.id),
    )

    for (let i = 0; i < queue.length; i++) {
      const mutation = queue[i]!
      try {
        if (mutation.kind === 'patch') {
          const { base_version: _v, base_updated_at: _t, ...body } =
            mutation.body
          await api(`/api/groceries/items/${encodeURIComponent(mutation.itemId)}`, {
            method: 'PATCH',
            body,
          })
        } else if (mutation.kind === 'add') {
          await api('/api/groceries/items', {
            method: 'POST',
            body: { ...mutation.body, week_start: mutation.weekStart },
          })
        } else if (mutation.kind === 'delete') {
          await api(
            `/api/groceries/items/${encodeURIComponent(mutation.itemId)}`,
            { method: 'DELETE' },
          )
        }
        flushed += 1
      } catch (err) {
        if (isNetworkError(err)) {
          // Stop flushing; keep this and later mutations queued.
          remaining.push(...queue.slice(i))
          saveOfflineQueue(remaining)
          return { flushed, errors }
        }
        errors.push(
          err instanceof Error ? err.message : 'Offline sync failed',
        )
        // Drop failed non-network mutations (e.g. 404 deleted item).
      }
    }

    saveOfflineQueue(remaining)
  } finally {
    flushing = false
  }

  return { flushed, errors }
}
