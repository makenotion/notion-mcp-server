import path from 'node:path'
import { fileURLToPath } from 'url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID, randomBytes } from 'node:crypto'
import express from 'express'

import { initProxy, ValidationError } from '../src/init-server'
import { getNotionToken, clearStoredToken, loadStoredToken } from '../src/openapi-mcp-server/auth/oauth'

export async function startServer(args: string[] = process.argv) {
  const filename = fileURLToPath(import.meta.url)
  const directory = path.dirname(filename)
  const specPath = path.resolve(directory, '../scripts/notion-openapi.json')
  
  const baseUrl = process.env.BASE_URL ?? undefined

  // Parse command line arguments manually (similar to slack-mcp approach)
  function parseArgs() {
    const args = process.argv.slice(2);
    let transport = 'stdio'; // default
    let port = 3000;
    let authToken: string | undefined;
    let disableAuth = false;
    let useOAuth = false;
    let oauthClientId: string | undefined;
    let oauthClientSecret: string | undefined;
    let clearToken = false;
    let showTokenInfo = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--transport' && i + 1 < args.length) {
        transport = args[i + 1];
        i++; // skip next argument
      } else if (args[i] === '--port' && i + 1 < args.length) {
        port = parseInt(args[i + 1], 10);
        i++; // skip next argument
      } else if (args[i] === '--auth-token' && i + 1 < args.length) {
        authToken = args[i + 1];
        i++; // skip next argument
      } else if (args[i] === '--disable-auth') {
        disableAuth = true;
      } else if (args[i] === '--oauth') {
        useOAuth = true;
      } else if (args[i] === '--oauth-client-id' && i + 1 < args.length) {
        oauthClientId = args[i + 1];
        i++;
      } else if (args[i] === '--oauth-client-secret' && i + 1 < args.length) {
        oauthClientSecret = args[i + 1];
        i++;
      } else if (args[i] === '--clear-token') {
        clearToken = true;
      } else if (args[i] === '--token-info') {
        showTokenInfo = true;
      } else if (args[i] === '--help' || args[i] === '-h') {
        console.log(`
Usage: notion-mcp-server [options]

Options:
  --transport <type>           Transport type: 'stdio' or 'http' (default: stdio)
  --port <number>              Port for HTTP server (default: 3000)
  --auth-token <token>         Bearer token for HTTP transport authentication
  --disable-auth               Disable bearer token auth for HTTP transport

  OAuth Options:
  --oauth                      Enable OAuth flow (opens browser for authorization)
  --oauth-client-id <id>       OAuth client ID (or use NOTION_OAUTH_CLIENT_ID env var)
  --oauth-client-secret <s>    OAuth client secret (or use NOTION_OAUTH_CLIENT_SECRET env var)
  --clear-token                Clear stored OAuth token and exit
  --token-info                 Show stored token info and exit

  --help, -h                   Show this help message

Environment Variables:
  NOTION_TOKEN                 Notion integration token (direct auth)
  NOTION_OAUTH_CLIENT_ID       OAuth client ID for browser-based auth
  NOTION_OAUTH_CLIENT_SECRET   OAuth client secret for browser-based auth
  OPENAPI_MCP_HEADERS          JSON string with custom headers
  AUTH_TOKEN                   Bearer token for HTTP transport

Authentication Priority:
  1. NOTION_TOKEN env var (direct integration token)
  2. Stored OAuth token (from previous --oauth flow)
  3. OAuth flow (if --oauth or OAuth env vars are set)

Examples:
  # Direct token auth (existing behavior)
  NOTION_TOKEN=ntn_**** notion-mcp-server

  # OAuth flow (opens browser, stores token for future use)
  notion-mcp-server --oauth --oauth-client-id abc --oauth-client-secret xyz

  # OAuth with env vars
  NOTION_OAUTH_CLIENT_ID=abc NOTION_OAUTH_CLIENT_SECRET=xyz notion-mcp-server --oauth

  # After OAuth, just run (uses stored token)
  notion-mcp-server

  # Clear stored token
  notion-mcp-server --clear-token

  # View stored token info
  notion-mcp-server --token-info
`);
        process.exit(0);
      }
      // Ignore unrecognized arguments (like command name passed by Docker)
    }

    return {
      transport: transport.toLowerCase(),
      port,
      authToken,
      disableAuth,
      useOAuth,
      oauthClientId,
      oauthClientSecret,
      clearToken,
      showTokenInfo,
    };
  }

  const options = parseArgs()

  // Handle --clear-token
  if (options.clearToken) {
    clearStoredToken()
    console.log('OAuth token cleared.')
    process.exit(0)
  }

  // Handle --token-info
  if (options.showTokenInfo) {
    const token = loadStoredToken()
    if (token) {
      console.log('Stored OAuth token info:')
      console.log(`  Workspace: ${token.workspace_name || token.workspace_id}`)
      console.log(`  Bot ID: ${token.bot_id}`)
      console.log(`  Created: ${new Date(token.created_at).toISOString()}`)
      if (token.owner?.user) {
        console.log(`  Owner: ${token.owner.user.name} (${token.owner.user.id})`)
      }
    } else {
      console.log('No stored OAuth token found.')
    }
    process.exit(0)
  }

  // Handle OAuth authentication
  if (options.useOAuth || process.env.NOTION_OAUTH_CLIENT_ID) {
    const clientId = options.oauthClientId || process.env.NOTION_OAUTH_CLIENT_ID
    const clientSecret = options.oauthClientSecret || process.env.NOTION_OAUTH_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      console.error('OAuth requires both client ID and client secret.')
      console.error('Set via --oauth-client-id/--oauth-client-secret or NOTION_OAUTH_CLIENT_ID/NOTION_OAUTH_CLIENT_SECRET env vars.')
      process.exit(1)
    }

    try {
      const token = await getNotionToken({ clientId, clientSecret })
      // Set the token as env var for the server to use
      process.env.NOTION_TOKEN = token
      console.log('OAuth authentication successful.')
    } catch (error) {
      console.error('OAuth authentication failed:', (error as Error).message)
      process.exit(1)
    }
  } else if (!process.env.NOTION_TOKEN && !process.env.OPENAPI_MCP_HEADERS) {
    // Check for stored token if no direct token is provided
    const storedToken = loadStoredToken()
    if (storedToken) {
      process.env.NOTION_TOKEN = storedToken.access_token
      console.log(`Using stored OAuth token for workspace: ${storedToken.workspace_name || storedToken.workspace_id}`)
    }
  }

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
    if (!options.disableAuth) {
      authToken = options.authToken || process.env.AUTH_TOKEN || randomBytes(32).toString('hex')
      if (!options.authToken && !process.env.AUTH_TOKEN) {
        console.log(`Generated auth token: ${authToken}`)
        console.log(`Use this token in the Authorization header: Bearer ${authToken}`)
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
    app.listen(port, '0.0.0.0', () => {
      console.log(`MCP Server listening on port ${port}`)
      console.log(`Endpoint: http://0.0.0.0:${port}/mcp`)
      console.log(`Health check: http://0.0.0.0:${port}/health`)
      if (options.disableAuth) {
        console.log(`Authentication: Disabled`)
      } else {
        console.log(`Authentication: Bearer token required`)
        if (options.authToken) {
          console.log(`Using provided auth token`)
        }
      }
    })

    // Return a dummy server for compatibility
    return { close: () => {} }
  } else {
    throw new Error(`Unsupported transport: ${transport}. Use 'stdio' or 'http'.`)
  }
}

startServer(process.argv).catch(error => {
  if (error instanceof ValidationError) {
    console.error('Invalid OpenAPI 3.1 specification:')
    error.errors.forEach(err => console.error(err))
  } else {
    console.error('Error:', error)
  }
  process.exit(1)
})
