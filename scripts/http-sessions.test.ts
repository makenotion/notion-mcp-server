import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SESSION_IDLE_TIMEOUT_MS, HttpSessionRegistry } from './http-sessions'

const IDLE_MS = 1000

function createRegistry() {
  let now = 10_000
  const registry = new HttpSessionRegistry<{ close: () => Promise<void> }>(IDLE_MS, () => now)
  const advance = (ms: number) => {
    now += ms
  }
  return { registry, advance }
}

function createTransport() {
  return { close: vi.fn(() => Promise.resolve()) }
}

describe('HttpSessionRegistry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps a new session until it has been idle for longer than the timeout', () => {
    const { registry, advance } = createRegistry()
    const transport = createTransport()
    registry.add('fresh', transport)

    advance(IDLE_MS)
    expect(registry.evictIdle()).toBe(0)
    expect(registry.size).toBe(1)

    advance(1)
    expect(registry.evictIdle()).toBe(1)
    expect(transport.close).toHaveBeenCalledOnce()
    expect(registry.attach('fresh', new EventEmitter())).toBeUndefined()
  })

  it('restarts the idle clock on every request', () => {
    const { registry, advance } = createRegistry()
    const transport = createTransport()
    registry.add('active', transport)

    advance(IDLE_MS)
    const response = new EventEmitter()
    expect(registry.attach('active', response)).toBe(transport)
    response.emit('close')
    advance(IDLE_MS)

    expect(registry.evictIdle()).toBe(0)
    expect(transport.close).not.toHaveBeenCalled()
  })

  it('never evicts a session while it holds an open response such as the SSE stream', () => {
    const { registry, advance } = createRegistry()
    const transport = createTransport()
    registry.add('streaming', transport)
    const stream = new EventEmitter()
    registry.attach('streaming', stream)

    advance(IDLE_MS * 10)
    expect(registry.evictIdle()).toBe(0)

    stream.emit('close')
    advance(IDLE_MS)
    expect(registry.evictIdle()).toBe(0)

    advance(1)
    expect(registry.evictIdle()).toBe(1)
    expect(transport.close).toHaveBeenCalledOnce()
  })

  it('keeps a session until all of its open responses have closed', () => {
    const { registry, advance } = createRegistry()
    registry.add('busy', createTransport())
    const stream = new EventEmitter()
    const request = new EventEmitter()
    registry.attach('busy', stream)
    registry.attach('busy', request)

    request.emit('close')
    advance(IDLE_MS + 1)

    expect(registry.evictIdle()).toBe(0)
  })

  it('forgets a deleted session', () => {
    const { registry, advance } = createRegistry()
    const transport = createTransport()
    registry.add('deleted', transport)

    registry.delete('deleted')
    advance(IDLE_MS + 1)

    expect(registry.attach('deleted', new EventEmitter())).toBeUndefined()
    expect(registry.evictIdle()).toBe(0)
    expect(transport.close).not.toHaveBeenCalled()
  })

  it('logs a transport that fails to close instead of rejecting', async () => {
    const { registry, advance } = createRegistry()
    const error = new Error('close failed')
    registry.add('broken', { close: () => Promise.reject(error) })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    advance(IDLE_MS + 1)
    expect(registry.evictIdle()).toBe(1)
    await new Promise(resolve => setImmediate(resolve))

    expect(consoleError).toHaveBeenCalledWith('Error closing idle session broken:', error)
    expect(registry.size).toBe(0)
  })

  it('evicts only the idle session when another one is streaming or recently used', () => {
    const { registry, advance } = createRegistry()
    const idle = createTransport()
    const streaming = createTransport()
    const recent = createTransport()
    registry.add('idle', idle)
    registry.add('streaming', streaming)
    registry.add('recent', recent)
    registry.attach('streaming', new EventEmitter())

    advance(IDLE_MS)
    const request = new EventEmitter()
    registry.attach('recent', request)
    request.emit('close')
    advance(1)

    expect(registry.evictIdle()).toBe(1)
    expect(idle.close).toHaveBeenCalledOnce()
    expect(streaming.close).not.toHaveBeenCalled()
    expect(recent.close).not.toHaveBeenCalled()
    expect(registry.attach('streaming', new EventEmitter())).toBe(streaming)
    expect(registry.attach('recent', new EventEmitter())).toBe(recent)
  })

  it('tolerates a response closing after its session was deleted', () => {
    const { registry, advance } = createRegistry()
    registry.add('closing', createTransport())
    const response = new EventEmitter()
    registry.attach('closing', response)

    registry.delete('closing')
    expect(() => response.emit('close')).not.toThrow()
    advance(IDLE_MS + 1)

    expect(registry.size).toBe(0)
    expect(registry.evictIdle()).toBe(0)
  })

  it('defaults to a 30 minute idle timeout on the wall clock', () => {
    vi.useFakeTimers()
    try {
      const registry = new HttpSessionRegistry<{ close: () => Promise<void> }>()
      registry.add('default', createTransport())

      vi.advanceTimersByTime(DEFAULT_SESSION_IDLE_TIMEOUT_MS)
      expect(DEFAULT_SESSION_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000)
      expect(registry.evictIdle()).toBe(0)

      vi.advanceTimersByTime(1)
      expect(registry.evictIdle()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns undefined for an unknown session id', () => {
    const { registry } = createRegistry()

    expect(registry.attach('unknown', new EventEmitter())).toBeUndefined()
    expect(registry.attach(undefined, new EventEmitter())).toBeUndefined()
  })
})
