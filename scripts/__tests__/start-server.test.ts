import { describe, expect, it } from 'vitest'

import { isLoopbackHost, parseServerOptions, validateServerOptions } from '../start-server'

const argv = (...args: string[]) => ['node', 'scripts/start-server.ts', ...args]

describe('start-server option parsing', () => {
  it('parses the provided argv instead of the process argv', () => {
    const originalArgv = process.argv
    process.argv = argv('--transport', 'stdio')

    try {
      const options = parseServerOptions(argv('--transport', 'http', '--host', '127.0.0.1', '--port', '8080'))

      expect(options.transport).toBe('http')
      expect(options.host).toBe('127.0.0.1')
      expect(options.port).toBe(8080)
    } finally {
      process.argv = originalArgv
    }
  })

  it('keeps HTTP bound to all interfaces by default when authentication is enabled', () => {
    const options = parseServerOptions(argv('--transport', 'http'))

    expect(options.host).toBe('0.0.0.0')
    expect(options.disableAuth).toBe(false)
    expect(() => validateServerOptions(options)).not.toThrow()
  })
})

describe('start-server unsafe auth-disable guard', () => {
  it('rejects unauthenticated HTTP on all interfaces', () => {
    const options = parseServerOptions(argv('--transport', 'http', '--disable-auth'))

    expect(() => validateServerOptions(options)).toThrow(/--disable-auth is only allowed/)
  })

  it.each(['127.0.0.1', 'localhost', '::1'])('allows unauthenticated HTTP on loopback host %s', (host) => {
    const options = parseServerOptions(argv('--transport', 'http', '--host', host, '--disable-auth'))

    expect(isLoopbackHost(host)).toBe(true)
    expect(() => validateServerOptions(options)).not.toThrow()
  })

  it('does not apply the HTTP auth-disable guard to stdio transport', () => {
    const options = parseServerOptions(argv('--transport', 'stdio', '--disable-auth'))

    expect(() => validateServerOptions(options)).not.toThrow()
  })
})
