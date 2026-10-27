import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { HttpSessionRegistry } from './http-sessions'

const IDLE_MS = 1000

function createRegistry() {
  let now = 0
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
  it('evicts and closes a session whose client went away without DELETE', () => {
    const { registry, advance } = createRegistry()
    const transport = createTransport()
    registry.add('abandoned', transport)

    advance(IDLE_MS + 1)

    expect(registry.evictIdle()).toBe(1)
    expect(transport.close).toHaveBeenCalledOnce()
    expect(registry.attach('abandoned', new EventEmitter())).toBeUndefined()
  })

  it('keeps a session that was used within the idle timeout', () => {
    const { registry, advance } = createRegistry()
    const transport = createTransport()
    registry.add('active', transport)

    advance(IDLE_MS - 1)
    const response = new EventEmitter()
    expect(registry.attach('active', response)).toBe(transport)
    response.emit('close')
    advance(IDLE_MS - 1)

    expect(registry.evictIdle()).toBe(0)
    expect(transport.close).not.toHaveBeenCalled()
    expect(registry.size).toBe(1)
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
    advance(IDLE_MS + 1)
    expect(registry.evictIdle()).toBe(1)
    expect(transport.close).toHaveBeenCalledOnce()
  })

  it('returns undefined for an unknown session id', () => {
    const { registry } = createRegistry()

    expect(registry.attach('unknown', new EventEmitter())).toBeUndefined()
    expect(registry.attach(undefined, new EventEmitter())).toBeUndefined()
  })
})
