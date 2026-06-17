import { describe, expect, it } from 'vitest'
import type { IncomingHttpHeaders } from 'node:http'
import {
  NOTION_TOKEN_HEADER,
  isNotionToken,
  notionHeadersForToken,
  redactToken,
  resolveNotionToken,
} from '../token'

const NTN = `ntn_${'a'.repeat(40)}`
const LEGACY = `secret_${'b'.repeat(40)}`

describe('isNotionToken', () => {
  it('accepts current and legacy Notion token prefixes', () => {
    expect(isNotionToken(NTN)).toBe(true)
    expect(isNotionToken(LEGACY)).toBe(true)
  })

  it('rejects values without a Notion prefix', () => {
    expect(isNotionToken('Bearer-abc')).toBe(false)
    expect(isNotionToken('some-gateway-secret')).toBe(false)
  })

  it('rejects empty, too-short, and too-long values', () => {
    expect(isNotionToken('')).toBe(false)
    expect(isNotionToken(undefined)).toBe(false)
    expect(isNotionToken(null)).toBe(false)
    expect(isNotionToken('ntn_')).toBe(false)
    expect(isNotionToken(`ntn_${'x'.repeat(400)}`)).toBe(false)
  })

  it('trims surrounding whitespace', () => {
    expect(isNotionToken(`  ${NTN}  `)).toBe(true)
  })
})

describe('notionHeadersForToken', () => {
  it('builds an Authorization header (Notion-Version is sourced per-operation from the spec)', () => {
    expect(notionHeadersForToken(NTN)).toEqual({
      Authorization: `Bearer ${NTN}`,
    })
  })
})

describe('resolveNotionToken', () => {
  const headers = (h: IncomingHttpHeaders) => h

  it('reads a valid token from the dedicated header', () => {
    const result = resolveNotionToken(headers({ [NOTION_TOKEN_HEADER]: NTN }), {
      allowAuthorizationFallback: false,
    })
    expect(result).toEqual({ status: 'ok', token: NTN })
  })

  it('errors when the dedicated header is present but malformed', () => {
    const result = resolveNotionToken(headers({ [NOTION_TOKEN_HEADER]: 'not-a-token' }), {
      allowAuthorizationFallback: false,
    })
    expect(result.status).toBe('invalid')
  })

  it('ignores Authorization when fallback is disabled (gateway auth in use)', () => {
    const result = resolveNotionToken(headers({ authorization: `Bearer ${NTN}` }), {
      allowAuthorizationFallback: false,
    })
    expect(result).toEqual({ status: 'absent' })
  })

  it('reads a Notion token from Authorization when fallback is enabled', () => {
    const result = resolveNotionToken(headers({ authorization: `Bearer ${NTN}` }), {
      allowAuthorizationFallback: true,
    })
    expect(result).toEqual({ status: 'ok', token: NTN })
  })

  it('ignores non-Notion Authorization bearer tokens', () => {
    const result = resolveNotionToken(headers({ authorization: 'Bearer gateway-secret' }), {
      allowAuthorizationFallback: true,
    })
    expect(result).toEqual({ status: 'absent' })
  })

  it('returns absent when no token headers are present', () => {
    expect(resolveNotionToken(headers({}), { allowAuthorizationFallback: true })).toEqual({
      status: 'absent',
    })
  })

  it('prefers the dedicated header over Authorization', () => {
    const result = resolveNotionToken(
      headers({ [NOTION_TOKEN_HEADER]: NTN, authorization: `Bearer ${LEGACY}` }),
      { allowAuthorizationFallback: true },
    )
    expect(result).toEqual({ status: 'ok', token: NTN })
  })

  it('handles array-valued headers by using the first value', () => {
    const result = resolveNotionToken(headers({ [NOTION_TOKEN_HEADER]: [NTN, LEGACY] }), {
      allowAuthorizationFallback: false,
    })
    expect(result).toEqual({ status: 'ok', token: NTN })
  })
})

describe('redactToken', () => {
  it('keeps the prefix and masks the secret', () => {
    const redacted = redactToken(NTN)
    expect(redacted.startsWith('ntn_')).toBe(true)
    expect(redacted).not.toContain('aaaa')
    expect(redacted).toContain(String(NTN.length))
  })
})
