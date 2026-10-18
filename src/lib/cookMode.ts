/** Split recipe instructions into navigable steps. */
export function splitInstructionSteps(instructions: string | null): string[] {
  if (!instructions?.trim()) return []
  const text = instructions.replace(/\r\n/g, '\n').trim()

  // Numbered lines: "1. …" / "1) …" / "Step 1:"
  const numbered = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const lookNumbered = numbered.filter((l) =>
    /^(?:step\s*)?\d+[.):]\s+/i.test(l),
  )
  if (lookNumbered.length >= 2) {
    return lookNumbered.map((l) =>
      l.replace(/^(?:step\s*)?\d+[.):]\s+/i, '').trim(),
    )
  }

  // Blank-line paragraphs
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n+/g, ' ').trim())
    .filter(Boolean)
  if (paras.length >= 2) return paras

  // Single newlines as steps when enough lines
  if (numbered.length >= 2) return numbered

  return [text]
}

/**
 * Find easy "N minutes" / "N min" / "N-minute" mentions in a step.
 * Returns unique positive minute values (capped).
 */
export function parseTimerMinutes(step: string): number[] {
  const found = new Set<number>()
  const re =
    /\b(\d{1,3})\s*(?:-\s*)?(?:to\s+\d{1,3}\s+)?(?:minutes?|mins?|min)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(step)) != null) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0 && n <= 180) found.add(n)
  }
  // "N-minute" compound adjectives
  const re2 = /\b(\d{1,3})-minute\b/gi
  while ((m = re2.exec(step)) != null) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0 && n <= 180) found.add(n)
  }
  return [...found].sort((a, b) => a - b)
}

export function formatTimerClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${String(rem).padStart(2, '0')}`
}
