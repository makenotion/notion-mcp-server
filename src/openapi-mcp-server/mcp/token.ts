import type { IncomingHttpHeaders } from 'node:http'

/**
 * Per-request Notion token handling for the Streamable HTTP transport.
 *
 * By default the server authenticates to Notion with a single token baked in at
 * startup (`NOTION_TOKEN` / `OPENAPI_MCP_HEADERS`), which locks one deployment to
 * one Notion integration. When token passthrough is enabled, each HTTP client
 * instead supplies its own Notion integration token per connection, so a single
 * deployment can serve many integrations.
 */

/**
 * Dedicated, unambiguous header for passing a Notion integration token. Lower
 * case because Node normalizes incoming header names to lower case.
 */
export const NOTION_TOKEN_HEADER = 'notion-token'

/**
 * Notion integration tokens use stable, recognizable prefixes:
 * - `ntn_`    — current internal & OAuth integration tokens
 * - `secret_` — legacy internal integration tokens
 *
 * Restricting to these prefixes lets us safely tell a Notion token apart from
 * the server's own `--auth-token` gateway secret carried on `Authorization`.
 */
const NOTION_TOKEN_PREFIXES = ['ntn_', 'secret_']

// Generous but bounded sanity check; guards against absurd inputs without
// coupling to an exact server-side length we don't control.
const MIN_TOKEN_LENGTH = 8
const MAX_TOKEN_LENGTH = 300

/**
 * Whether a string looks like a Notion integration token. This is a cheap shape
 * check, not a validity check — the Notion API is the source of truth and will
 * reject bad tokens. We only need enough certainty to route the request.
 */
export function isNotionToken(value: string | undefined | null): value is string {
  if (!value) {
    return false
  }
  const token = value.trim()
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    return false
  }
  return NOTION_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))
}

/**
 * Build the Notion API headers for a raw integration token.
 *
 * Notion-Version is intentionally omitted: it is sourced per-operation from the
 * OpenAPI spec by HttpClient, so each endpoint pins the version it needs (e.g.
 * the page-markdown endpoints require 2026-03-11 while the rest stay 2025-09-03).
 */
export function notionHeadersForToken(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
  }
}

export type TokenResolution =
  | { status: 'ok'; token: string }
  | { status: 'invalid'; reason: string }
  | { status: 'absent' }

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Resolve a per-request Notion token from incoming HTTP headers.
 *
 * Precedence:
 *  1. `Notion-Token` — explicit and unambiguous. If present it MUST be a valid
 *     looking token, otherwise we surface an error rather than silently falling
 *     back (which would be confusing to debug).
 *  2. `Authorization: Bearer <token>` — only consulted when
 *     `allowAuthorizationFallback` is set (i.e. the server's own gateway auth is
 *     disabled, so `Authorization` is free to carry the Notion token) and only
 *     when the value carries a Notion prefix.
 *
 * Returns `absent` when no token header is supplied so the caller can decide
 * whether to fall back to the startup env token.
 */
export function resolveNotionToken(
  headers: IncomingHttpHeaders,
  { allowAuthorizationFallback }: { allowAuthorizationFallback: boolean },
): TokenResolution {
  const explicit = firstHeaderValue(headers[NOTION_TOKEN_HEADER])
  if (explicit !== undefined) {
    const token = explicit.trim()
    return isNotionToken(token)
      ? { status: 'ok', token }
      : {
          status: 'invalid',
          reason: `${NOTION_TOKEN_HEADER} header is present but is not a valid Notion integration token`,
        }
  }

  if (allowAuthorizationFallback) {
    const authorization = firstHeaderValue(headers['authorization'])
    if (authorization) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
      const candidate = match?.[1]?.trim()
      if (candidate && isNotionToken(candidate)) {
        return { status: 'ok', token: candidate }
      }
    }
  }

  return { status: 'absent' }
}

/**
 * Redact a token for safe logging: keep the recognizable prefix, mask the
 * secret. Never log the raw token.
 */
export function redactToken(token: string): string {
  const underscore = token.indexOf('_')
  const prefix = underscore === -1 ? '' : token.slice(0, underscore + 1)
  return `${prefix}…(${token.length} chars)`
}
