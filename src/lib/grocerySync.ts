import type { GroceryItemView, GroceryListDetail } from '../../shared/types'

export type GroceryStreamEvent =
  | {
      type: 'list'
      week_start: string
      list: GroceryListDetail
    }
  | {
      type: 'item'
      week_start: string
      item: GroceryItemView
    }
  | {
      type: 'item_deleted'
      week_start: string
      item_id: string
      grocery_list_id: string
    }

export type GroceryStreamHandlers = {
  onEvent: (event: GroceryStreamEvent) => void
  onError?: (err: Event) => void
  onOpen?: () => void
}

/**
 * Subscribe to household grocery SSE. EventSource is same-origin so the
 * session cookie is sent automatically.
 */
export function subscribeGroceryStream(
  weekStart: string,
  handlers: GroceryStreamHandlers,
): () => void {
  const url = `/api/groceries/stream?week_start=${encodeURIComponent(weekStart)}`
  const es = new EventSource(url, { withCredentials: true })

  es.addEventListener('grocery', (raw) => {
    try {
      const data = JSON.parse((raw as MessageEvent).data) as GroceryStreamEvent
      handlers.onEvent(data)
    } catch {
      /* ignore malformed */
    }
  })

  es.onopen = () => handlers.onOpen?.()
  es.onerror = (err) => handlers.onError?.(err)

  return () => {
    es.close()
  }
}

export function applyStreamEvent(
  list: GroceryListDetail | null,
  event: GroceryStreamEvent,
  pendingIds: Set<string>,
): GroceryListDetail | null {
  if (!list) return list
  if (event.week_start && list.week_start && event.week_start !== list.week_start) {
    return list
  }

  if (event.type === 'list') {
    // Full list replace with per-item pending preservation handled by caller merge.
    return event.list
  }

  if (event.type === 'item_deleted') {
    if (pendingIds.has(event.item_id)) return list
    return {
      ...list,
      items: list.items.filter((i) => i.id !== event.item_id),
    }
  }

  // item update
  if (pendingIds.has(event.item.id)) return list
  const idx = list.items.findIndex((i) => i.id === event.item.id)
  if (idx < 0) {
    return { ...list, items: [...list.items, event.item] }
  }
  const prev = list.items[idx]!
  // Prefer newer server version for this item only.
  if (
    (event.item.version ?? 0) < (prev.version ?? 0) ||
    ((event.item.version ?? 0) === (prev.version ?? 0) &&
      (event.item.updated_at ?? '') < (prev.updated_at ?? ''))
  ) {
    return list
  }
  const items = list.items.slice()
  items[idx] = event.item
  return { ...list, items }
}
