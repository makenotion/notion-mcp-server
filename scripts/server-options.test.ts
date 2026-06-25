import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HTTP_HOST,
  getDnsRebindingProtectionOptions,
  getHelpText,
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

  it('parses extra allowed hosts from a comma-separated flag', () => {
    const options = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--allowed-hosts',
      ' app.local,devbox.local,, app.local ',
    ])

    expect(options.allowedHosts).toEqual(['app.local', 'devbox.local', 'app.local'])
  })

  it('appends extra allowed hosts across repeated flags', () => {
    const options = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--allowed-hosts',
      'app.local,devbox.local',
      '--allowed-hosts',
      'admin.local',
    ])

    expect(options.allowedHosts).toEqual(['app.local', 'devbox.local', 'admin.local'])
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

  it('adds extra hosts to DNS rebinding protection host and origin allowlists', () => {
    const options = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--port',
      '4321',
      '--unsafe-disable-auth',
      '--allowed-hosts',
      ' app.local,::1,app.local ',
    ])

    const dnsOptions = getDnsRebindingProtectionOptions(options)
    if (!dnsOptions) {
      throw new Error('Expected DNS rebinding protection options')
    }
    const { allowedHosts } = dnsOptions
    if (!allowedHosts) {
      throw new Error('Expected DNS rebinding protection allowed hosts')
    }

    expect(allowedHosts).toContain('app.local')
    expect(allowedHosts).toContain('app.local:4321')
    expect(dnsOptions.allowedOrigins).toContain('http://app.local:4321')
    expect(allowedHosts.filter((host) => host === '[::1]')).toHaveLength(1)
    expect(allowedHosts.filter((host) => host === '[::1]:4321')).toHaveLength(1)
  })

  it('keeps DNS rebinding protection off when HTTP auth is enabled', () => {
    const options = parseServerOptions([...argv, '--transport', 'http'])

    expect(getDnsRebindingProtectionOptions(options)).toBeUndefined()
  })

  it('does not enable DNS rebinding protection when allowed hosts are set but auth stays enabled', () => {
    const options = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--allowed-hosts',
      'app.local',
    ])

    expect(getDnsRebindingProtectionOptions(options)).toBeUndefined()
  })

  it('documents the allowed hosts flag in the help text', () => {
    expect(getHelpText()).toContain('--allowed-hosts <hosts>')
  })

  it('parses stateless HTTP mode from the CLI flag', () => {
    const options = parseServerOptions([
      ...argv,
      '--transport',
      'http',
      '--stateless-http',
    ])

    expect(options.enableStatelessHttp).toBe(true)
  })

  it('reads stateless HTTP mode from the environment', () => {
    const original = process.env.ENABLE_STATELESS_HTTP
    process.env.ENABLE_STATELESS_HTTP = 'true'

    try {
      const options = parseServerOptions([...argv, '--transport', 'http'])
      expect(options.enableStatelessHttp).toBe(true)
    } finally {
      if (original === undefined) {
        delete process.env.ENABLE_STATELESS_HTTP
      } else {
        process.env.ENABLE_STATELESS_HTTP = original
      }
    }
  })

  it('documents stateless HTTP mode in the help text', () => {
    expect(getHelpText()).toContain('--stateless-http')
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
