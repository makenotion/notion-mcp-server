import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpSessionRegistry } from './http-sessions'

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

  it('returns undefined for an unknown session id', () => {
    const { registry } = createRegistry()

    expect(registry.attach('unknown', new EventEmitter())).toBeUndefined()
    expect(registry.attach(undefined, new EventEmitter())).toBeUndefined()
  })
})
