/**
 * In-memory SSE fan-out for meal plan + prep updates (single-server Bun).
 * One household "plan" channel carries `{ type: 'plan' | 'prep' }` events.
 * Subscribers are keyed by household (+ optional week_start filter).
 */

export type PlanStreamEvent =
  | {
      type: 'plan'
      week_start: string
    }
  | {
      type: 'prep'
      week_start: string
    }

type Subscriber = {
  householdId: string
  weekStart: string | null
  send: (event: PlanStreamEvent) => void
  close: () => void
}

const subscribers = new Set<Subscriber>()

const encoder = new TextEncoder()

export function broadcastPlan(
  householdId: string,
  event: PlanStreamEvent,
): void {
  for (const sub of subscribers) {
    if (sub.householdId !== householdId) continue
    if (sub.weekStart && sub.weekStart !== event.week_start) continue
    try {
      sub.send(event)
    } catch {
      sub.close()
      subscribers.delete(sub)
    }
  }
}

export function openPlanStream(
  householdId: string,
  weekStart: string | null,
): Response {
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closed = false
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const sub: Subscriber = {
    householdId,
    weekStart,
    send(event) {
      if (closed || !controllerRef) return
      controllerRef.enqueue(
        encoder.encode(`event: plan\ndata: ${JSON.stringify(event)}\n\n`),
      )
    },
    close() {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      subscribers.delete(sub)
      try {
        controllerRef?.close()
      } catch {
        /* already closed */
      }
    },
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      subscribers.add(sub)
      controller.enqueue(encoder.encode(`: connected\n\n`))
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          sub.close()
        }
      }, 25_000)
    },
    cancel() {
      sub.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/** Test / diagnostics helper. */
export function planStreamSubscriberCount(): number {
  return subscribers.size
}
