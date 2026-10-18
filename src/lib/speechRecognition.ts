/** Minimal Web Speech API types — Chrome exposes webkitSpeechRecognition. */

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: { transcript: string }
}

export interface SpeechRecognitionEventLike {
  readonly results: ArrayLike<SpeechRecognitionResultLike>
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string
  readonly message?: string
}

export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function speechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

export function createSpeechRecognition(): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) return null
  return new Ctor()
}

/** Parse spoken grocery commands into add vs mark-bought. */
export function parseGroceryVoiceCommand(
  transcript: string,
): { kind: 'add'; name: string } | { kind: 'bought'; name: string } {
  const cleaned = transcript.trim().replace(/[.!?]+$/u, '').trim()
  if (!cleaned) return { kind: 'add', name: '' }

  const bought =
    /^(?:mark|check(?:\s+off)?)\s+(.+?)\s+(?:as\s+)?(?:bought|done|checked)$/iu.exec(
      cleaned,
    ) ?? /^(?:(?:i\s+)?(?:bought|got))\s+(.+)$/iu.exec(cleaned)

  if (bought?.[1]?.trim()) {
    return { kind: 'bought', name: bought[1].trim() }
  }

  const add = /^add(?:\s+(?:item|to\s+(?:the\s+)?list))?\s+(.+)$/iu.exec(cleaned)
  return { kind: 'add', name: (add?.[1] ?? cleaned).trim() }
}

export function finalTranscriptFromEvent(
  event: SpeechRecognitionEventLike,
): string | null {
  let text = ''
  let hasFinal = false
  for (let i = 0; i < event.results.length; i++) {
    const result = event.results[i]
    if (!result) continue
    if (result.isFinal) {
      hasFinal = true
      text += result[0]?.transcript ?? ''
    }
  }
  if (!hasFinal) return null
  return text.trim() || null
}

export function interimTranscriptFromEvent(
  event: SpeechRecognitionEventLike,
): string {
  let text = ''
  for (let i = 0; i < event.results.length; i++) {
    const result = event.results[i]
    if (!result) continue
    text += result[0]?.transcript ?? ''
  }
  return text.trim()
}
