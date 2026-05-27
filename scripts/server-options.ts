import type { StreamableHTTPServerTransportOptions } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

export const DEFAULT_HTTP_HOST = '127.0.0.1'

export type ServerOptions = {
  transport: string
  port: number
  host: string
  authToken: string | undefined
  unsafeDisableAuth: boolean
  usedDeprecatedDisableAuthFlag: boolean
}

type DnsRebindingProtectionOptions = Pick<
  StreamableHTTPServerTransportOptions,
  'allowedHosts' | 'allowedOrigins' | 'enableDnsRebindingProtection'
>

export function parseServerOptions(argv: string[] = process.argv): ServerOptions {
  const args = argv.slice(2)
  let transport = 'stdio'
  let port = 3000
  let host = DEFAULT_HTTP_HOST
  let authToken: string | undefined
  let unsafeDisableAuth = false
  let usedDeprecatedDisableAuthFlag = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transport' && i + 1 < args.length) {
      transport = args[i + 1]
      i++
    } else if (args[i] === '--port' && i + 1 < args.length) {
      port = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--host' && i + 1 < args.length) {
      host = args[i + 1]
      i++
    } else if (args[i] === '--auth-token' && i + 1 < args.length) {
      authToken = args[i + 1]
      i++
    } else if (args[i] === '--unsafe-disable-auth') {
      unsafeDisableAuth = true
    } else if (args[i] === '--disable-auth') {
      unsafeDisableAuth = true
      usedDeprecatedDisableAuthFlag = true
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(getHelpText())
      process.exit(0)
    }
    // Ignore unrecognized arguments (like command name passed by Docker)
  }

  return {
    transport: transport.toLowerCase(),
    port,
    host,
    authToken,
    unsafeDisableAuth,
    usedDeprecatedDisableAuthFlag,
  }
}

export function getHelpText(): string {
  return `
Usage: notion-mcp-server [options]

Options:
  --transport <type>       Transport type: 'stdio' or 'http' (default: stdio)
  --port <number>          Port for HTTP server when using Streamable HTTP transport (default: 3000)
  --host <host>            Host for HTTP server when using Streamable HTTP transport (default: 127.0.0.1)
  --auth-token <token>     Bearer token for HTTP transport authentication (auto-generated if not provided)
  --unsafe-disable-auth    Disable bearer token authentication for HTTP transport. Unsafe; use only on isolated networks.
  --disable-auth           Deprecated alias for --unsafe-disable-auth
  --help, -h               Show this help message

Environment Variables:
  NOTION_TOKEN             Notion integration token (recommended)
  OPENAPI_MCP_HEADERS      JSON string with Notion API headers (alternative)
  AUTH_TOKEN               Bearer token for HTTP transport authentication (alternative to --auth-token)

Examples:
  notion-mcp-server                                      # Use stdio transport (default)
  notion-mcp-server --transport stdio                    # Use stdio transport explicitly
  notion-mcp-server --transport http                     # Use Streamable HTTP transport on 127.0.0.1:3000
  notion-mcp-server --transport http --port 8080         # Use Streamable HTTP transport on port 8080
  notion-mcp-server --transport http --host 0.0.0.0      # Bind HTTP transport to all interfaces
  notion-mcp-server --transport http --auth-token mytoken # Use Streamable HTTP transport with custom auth token
  notion-mcp-server --transport http --unsafe-disable-auth # Use Streamable HTTP transport without authentication
  AUTH_TOKEN=mytoken notion-mcp-server --transport http  # Use Streamable HTTP transport with auth token from env var
`
}

export function getUnsafeAuthWarnings(options: ServerOptions): string[] {
  if (!options.unsafeDisableAuth) {
    return []
  }

  const warnings = [
    'WARNING: --unsafe-disable-auth disables bearer token authentication. A malicious website may be able to reach this server via DNS rebinding. Only use this on an isolated network.',
  ]

  if (options.usedDeprecatedDisableAuthFlag) {
    warnings.unshift(
      'WARNING: --disable-auth is deprecated because it is unsafe. Use --unsafe-disable-auth if you intentionally need unauthenticated HTTP.',
    )
  }

  if (!isLoopbackHost(options.host)) {
    warnings.push(
      `WARNING: unauthenticated HTTP is bound to ${options.host}. Prefer the default ${DEFAULT_HTTP_HOST} loopback binding unless this is an isolated network.`,
    )
  }

  return warnings
}

export function getDnsRebindingProtectionOptions(
  options: ServerOptions,
): DnsRebindingProtectionOptions | undefined {
  if (options.transport !== 'http' || !options.unsafeDisableAuth) {
    return undefined
  }

  return {
    enableDnsRebindingProtection: true,
    allowedHosts: getAllowedHosts(options.host, options.port),
    allowedOrigins: getAllowedOrigins(options.host, options.port),
  }
}

export function getHttpServerDisplayUrl(options: ServerOptions): string {
  return `http://${formatHostForUrl(displayHostForBinding(options.host))}:${options.port}`
}

function getAllowedHosts(host: string, port: number): string[] {
  const allowedHosts = new Set<string>()
  for (const allowedHost of ['localhost', '127.0.0.1', '[::1]', normalizeHostHeader(host)]) {
    allowedHosts.add(allowedHost)
    allowedHosts.add(`${allowedHost}:${port}`)
  }
  return [...allowedHosts]
}

function getAllowedOrigins(host: string, port: number): string[] {
  const allowedOrigins = new Set<string>()
  for (const allowedHost of ['localhost', '127.0.0.1', '[::1]', normalizeHostHeader(host)]) {
    allowedOrigins.add(`http://${formatHostForUrl(allowedHost)}:${port}`)
  }
  return [...allowedOrigins]
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function displayHostForBinding(host: string): string {
  if (host === '0.0.0.0') {
    return '127.0.0.1'
  }
  if (host === '::') {
    return '::1'
  }
  return host
}

function normalizeHostHeader(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`
  }
  return host
}

function formatHostForUrl(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host
  }
  if (host.includes(':')) {
    return `[${host}]`
  }
  return host
}
