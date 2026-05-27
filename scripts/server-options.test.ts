import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HTTP_HOST,
  getDnsRebindingProtectionOptions,
  getHttpServerDisplayUrl,
  getUnsafeAuthWarnings,
  parseServerOptions,
} from './server-options'

const argv = ['node', 'notion-mcp-server']

describe('server options', () => {
  it('binds HTTP transport to loopback by default', () => {
    const options = parseServerOptions([...argv, '--transport', 'http'])

    expect(options.transport).toBe('http')
    expect(options.host).toBe(DEFAULT_HTTP_HOST)
    expect(getHttpServerDisplayUrl(options)).toBe('http://127.0.0.1:3000')
  })

  it('supports an explicit HTTP host override', () => {
    const options = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--host',
      '0.0.0.0',
      '--port',
      '8080',
    ])

    expect(options.host).toBe('0.0.0.0')
    expect(options.port).toBe(8080)
    expect(getHttpServerDisplayUrl(options)).toBe('http://127.0.0.1:8080')
  })

  it('parses unsafe auth disabling and the deprecated alias', () => {
    const unsafeOptions = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--unsafe-disable-auth',
    ])
    const deprecatedOptions = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--disable-auth',
    ])

    expect(unsafeOptions.unsafeDisableAuth).toBe(true)
    expect(unsafeOptions.usedDeprecatedDisableAuthFlag).toBe(false)
    expect(deprecatedOptions.unsafeDisableAuth).toBe(true)
    expect(deprecatedOptions.usedDeprecatedDisableAuthFlag).toBe(true)
  })

  it('enables DNS rebinding protection when HTTP auth is disabled', () => {
    const options = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--port',
      '4321',
      '--unsafe-disable-auth',
    ])

    const dnsOptions = getDnsRebindingProtectionOptions(options)
    if (!dnsOptions) {
      throw new Error('Expected DNS rebinding protection options')
    }

    expect(dnsOptions.enableDnsRebindingProtection).toBe(true)
    expect(dnsOptions.allowedHosts).toContain('localhost:4321')
    expect(dnsOptions.allowedHosts).toContain('127.0.0.1:4321')
    expect(dnsOptions.allowedHosts).toContain('[::1]:4321')
    expect(dnsOptions.allowedOrigins).toContain('http://localhost:4321')
    expect(dnsOptions.allowedOrigins).toContain('http://127.0.0.1:4321')
    expect(dnsOptions.allowedOrigins).toContain('http://[::1]:4321')
  })

  it('keeps DNS rebinding protection off when HTTP auth is enabled', () => {
    const options = parseServerOptions([...argv, '--transport', 'http'])

    expect(getDnsRebindingProtectionOptions(options)).toBeUndefined()
  })

  it('warns clearly for unsafe auth disabling', () => {
    const options = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--host',
      '0.0.0.0',
      '--disable-auth',
    ])

    expect(getUnsafeAuthWarnings(options)).toEqual([
      'WARNING: --disable-auth is deprecated because it is unsafe. Use --unsafe-disable-auth if you intentionally need unauthenticated HTTP.',
      'WARNING: --unsafe-disable-auth disables bearer token authentication. A malicious website may be able to reach this server via DNS rebinding. Only use this on an isolated network.',
      'WARNING: unauthenticated HTTP is bound to 0.0.0.0. Prefer the default 127.0.0.1 loopback binding unless this is an isolated network.',
    ])
  })
})
