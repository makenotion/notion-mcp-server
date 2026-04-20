import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import express from 'express'

import { initProxy, ValidationError } from '../src/init-server'

type ServerOptions = {
  transport: string
  port: number
  host: string
  authToken: string | undefined
  disableAuth: boolean
}

export function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase()
  return normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '::1'
}

export function parseServerOptions(argv: string[] = process.argv): ServerOptions {
  const args = argv.slice(2);
  let transport = 'stdio'; // default
  let port = 3000;
  let host = '0.0.0.0';
  let authToken: string | undefined;
  let disableAuth = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transport' && i + 1 < args.length) {
      transport = args[i + 1];
      i++; // skip next argument
    } else if (args[i] === '--port' && i + 1 < args.length) {
      port = parseInt(args[i + 1], 10);
      i++; // skip next argument
    } else if (args[i] === '--host' && i + 1 < args.length) {
      host = args[i + 1];
      i++; // skip next argument
    } else if (args[i] === '--auth-token' && i + 1 < args.length) {
      authToken = args[i + 1];
      i++; // skip next argument
    } else if (args[i] === '--disable-auth') {
      disableAuth = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: notion-mcp-server [options]

Options:
  --transport <type>     Transport type: 'stdio' or 'http' (default: stdio)
  --port <number>        Port for HTTP server when using Streamable HTTP transport (default: 3000)
  --host <host>          Host for HTTP server when using Streamable HTTP transport (default: 0.0.0.0)
  --auth-token <token>   Bearer token for HTTP transport authentication (auto-generated if not provided)
  --disable-auth         Disable bearer token authentication for HTTP transport; requires --host localhost, 127.0.0.1, or ::1
  --help, -h             Show this help message

Environment Variables:
  NOTION_TOKEN           Notion integration token (recommended)
  OPENAPI_MCP_HEADERS    JSON string with Notion API headers (alternative)
  AUTH_TOKEN             Bearer token for HTTP transport authentication (alternative to --auth-token)

Examples:
  notion-mcp-server                                    # Use stdio transport (default)
  notion-mcp-server --transport stdio                  # Use stdio transport explicitly
  notion-mcp-server --transport http                   # Use Streamable HTTP transport on port 3000
  notion-mcp-server --transport http --port 8080       # Use Streamable HTTP transport on port 8080
  notion-mcp-server --transport http --host 127.0.0.1  # Bind HTTP transport to localhost only
  notion-mcp-server --transport http --auth-token mytoken # Use Streamable HTTP transport with custom auth token
  notion-mcp-server --transport http --host 127.0.0.1 --disable-auth # Use local-only HTTP transport without authentication
  AUTH_TOKEN=mytoken notion-mcp-server --transport http # Use Streamable HTTP transport with auth token from env var
`);
      process.exit(0);
    }
    // Ignore unrecognized arguments (like command name passed by Docker)
  }

  return { transport: transport.toLowerCase(), port, host, authToken, disableAuth };
}

export function validateServerOptions(options: ServerOptions): void {
  if (options.transport === 'http' && options.disableAuth && !isLoopbackHost(options.host)) {
    throw new Error('--disable-auth is only allowed when HTTP transport binds to a loopback host. Use --host 127.0.0.1, --host localhost, or --host ::1 for local-only testing.')
  }
}

function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

export async function startServer(args: string[] = process.argv) {
  const filename = fileURLToPath(import.meta.url)
  const directory = path.dirname(filename)
  const specPath = path.resolve(directory, '../scripts/notion-openapi.json')

  const baseUrl = process.env.BASE_URL ?? undefined

  const options = parseServerOptions(args)
  validateServerOptions(options)
  const transport = options.transport

  if (transport === 'stdio') {
    // Use stdio transport (default)
    const proxy = await initProxy(specPath, baseUrl)
    await proxy.connect(new StdioServerTransport())
    return proxy.getServer()
  } else if (transport === 'http') {
    // Use Streamable HTTP transport
    const app = express()
    app.use(express.json())

    // Generate or use provided auth token (from CLI arg or env var) only if auth is enabled
    let authToken: string | undefined
    let authTokenFilePath: string | undefined
    if (!options.disableAuth) {
      authToken = options.authToken || process.env.AUTH_TOKEN || randomBytes(32).toString('hex')
      if (!options.authToken && !process.env.AUTH_TOKEN) {
        // Write auto-generated token to a file with restricted permissions instead of logging it
        authTokenFilePath = path.join(os.tmpdir(), `.notion-mcp-auth-token-${process.pid}`)
        fs.writeFileSync(authTokenFilePath, authToken, { mode: 0o600 })
        console.log(`Generated auth token written to: ${authTokenFilePath}`)
      }
    }

    // Authorization middleware
    const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
      const authHeader = req.headers['authorization']
      const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

      if (!token) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Unauthorized: Missing bearer token',
          },
          id: null,
        })
        return
      }

      if (token !== authToken) {
        res.status(403).json({
          jsonrpc: '2.0',
          error: {
            code: -32002,
            message: 'Forbidden: Invalid bearer token',
          },
          id: null,
        })
        return
      }

      next()
    }

    // Health endpoint (no authentication required)
    app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        transport: 'http',
        port: options.port
      })
    })

    // Apply authentication to all /mcp routes only if auth is enabled
    if (!options.disableAuth) {
      app.use('/mcp', authenticateToken)
    }

    // Map to store transports by session ID
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {}

    // Handle POST requests for client-to-server communication
    app.post('/mcp', async (req, res) => {
      try {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined
        let transport: StreamableHTTPServerTransport

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          transport = transports[sessionId]
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
              // Store the transport by session ID
              transports[sessionId] = transport
            }
          })

          // Clean up transport when closed
          transport.onclose = () => {
            if (transport.sessionId) {
              delete transports[transport.sessionId]
            }
          }

          const proxy = await initProxy(specPath, baseUrl)
          await proxy.connect(transport)
        } else {
          // Invalid request
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          })
          return
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body)
      } catch (error) {
        console.error('Error handling MCP request:', error)
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          })
        }
      }
    })

    // Handle GET requests for server-to-client notifications via Streamable HTTP
    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID')
        return
      }
      
      const transport = transports[sessionId]
      await transport.handleRequest(req, res)
    })

    // Handle DELETE requests for session termination
    app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID')
        return
      }
      
      const transport = transports[sessionId]
      await transport.handleRequest(req, res)
    })

    const port = options.port
    const host = options.host
    const urlHost = formatHostForUrl(host)
    app.listen(port, host, async () => {
      console.log(`MCP Server listening on ${host}:${port}`)
      console.log(`Endpoint: http://${urlHost}:${port}/mcp`)
      console.log(`Health check: http://${urlHost}:${port}/health`)
      if (options.disableAuth) {
        console.warn(`Authentication: Disabled (loopback-only)`)
      } else {
        console.log(`Authentication: Bearer token required`)
        if (authTokenFilePath) {
          console.log(`Read your auth token from: ${authTokenFilePath}`)
        }
      }
      // Try to resolve the Notion integration link so users can manage their token
      const notionToken = process.env.NOTION_TOKEN
      if (notionToken) {
        try {
          const res = await fetch('https://api.notion.com/v1/users/me', {
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Notion-Version': '2022-06-28',
            },
          })
          if (res.ok) {
            const data = await res.json() as { id?: string; type?: string }
            if (data.id && data.type === 'bot') {
              console.log(`Notion integration settings: https://www.notion.so/profile/integrations/internal/${data.id}`)
            }
          }
        } catch {
          // Non-critical: silently ignore if we can't resolve the bot ID
        }
      }
    })

    // Return a dummy server for compatibility
    return { close: () => {} }
  } else {
    throw new Error(`Unsupported transport: ${transport}. Use 'stdio' or 'http'.`)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (import.meta.url === invokedPath) {
  startServer(process.argv).catch(error => {
    if (error instanceof ValidationError) {
      console.error('Invalid OpenAPI 3.1 specification:')
      error.errors.forEach(err => console.error(err))
    } else {
      console.error('Error:', error)
    }
    process.exit(1)
  })
}
