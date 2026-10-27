export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const SESSION_SWEEP_INTERVAL_MS = 60 * 1000

type ClosableTransport = { close(): Promise<void> }

type ClosableResponse = { on(event: 'close', listener: () => void): unknown }

type SessionEntry<T> = {
  transport: T
  lastSeen: number
  openResponses: number
}

// Clients are not required to send DELETE when they go away (an exited or
// killed process never does), so a session is also evicted once it has no
// open response, such as the GET SSE stream, and no request for idleTimeoutMs.
export class HttpSessionRegistry<T extends ClosableTransport> {
  private readonly sessions = new Map<string, SessionEntry<T>>()

  constructor(
    private readonly idleTimeoutMs: number = DEFAULT_SESSION_IDLE_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.sessions.size
  }

  add(sessionId: string, transport: T): void {
    this.sessions.set(sessionId, { transport, lastSeen: this.now(), openResponses: 0 })
  }

  attach(sessionId: string | undefined, response: ClosableResponse): T | undefined {
    const entry = sessionId ? this.sessions.get(sessionId) : undefined
    if (!entry) {
      return undefined
    }
    entry.lastSeen = this.now()
    entry.openResponses++
    response.on('close', () => {
      entry.openResponses--
      entry.lastSeen = this.now()
    })
    return entry.transport
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  evictIdle(): number {
    const now = this.now()
    let evicted = 0
    for (const [sessionId, entry] of this.sessions) {
      if (entry.openResponses === 0 && now - entry.lastSeen > this.idleTimeoutMs) {
        this.sessions.delete(sessionId)
        entry.transport.close().catch(error => {
          console.error(`Error closing idle session ${sessionId}:`, error)
        })
        evicted++
      }
    }
    return evicted
  }
}
