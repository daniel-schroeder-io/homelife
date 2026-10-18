export type PlanStreamEvent =
  | {
      type: 'plan'
      week_start: string
    }
  | {
      type: 'prep'
      week_start: string
    }

export type PlanStreamHandlers = {
  onEvent: (event: PlanStreamEvent) => void
  onError?: (err: Event) => void
  onOpen?: () => void
}

/**
 * Subscribe to household plan/prep SSE. EventSource is same-origin so the
 * session cookie is sent automatically.
 */
export function subscribePlanStream(
  weekStart: string,
  handlers: PlanStreamHandlers,
): () => void {
  const url = `/api/plans/stream?week_start=${encodeURIComponent(weekStart)}`
  const es = new EventSource(url, { withCredentials: true })

  es.addEventListener('plan', (raw) => {
    try {
      const data = JSON.parse((raw as MessageEvent).data) as PlanStreamEvent
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
