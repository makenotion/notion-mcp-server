import path from 'node:path'
import { fileURLToPath } from 'url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID, randomBytes } from 'node:crypto'
import express from 'express'

import { initProxy, ValidationError } from '../src/init-server'
import { createTPCOAuthProvider, type TPCOAuthServerProvider } from '../src/auth'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'

export async function startServer(args: string[] = process.argv) {
  const filename = fileURLToPath(import.meta.url)
  const directory = path.dirname(filename)
  const specPath = path.resolve(directory, '../scripts/notion-openapi.json')
  
  const baseUrl = process.env.BASE_URL ?? undefined

  // Parse command line arguments manually (similar to slack-mcp approach)
  function parseArgs() {
    const args = process.argv.slice(2);
    let transport = 'stdio'; // default
    let port = parseInt(process.env.PORT || '3000', 10);
    let authToken: string | undefined;

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
      } else if (args[i] === '--help' || args[i] === '-h') {
        console.log(`
Usage: notion-mcp-server [options]

Options:
  --transport <type>     Transport type: 'stdio' or 'http' (default: stdio)
  --port <number>        Port for HTTP server when using Streamable HTTP transport (default: 3000)
  --auth-token <token>   Bearer token for HTTP transport authentication (optional)
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
  notion-mcp-server --transport http --auth-token mytoken # Use Streamable HTTP transport with custom auth token
  AUTH_TOKEN=mytoken notion-mcp-server --transport http # Use Streamable HTTP transport with auth token from env var
`);
        process.exit(0);
      }
      // Ignore unrecognized arguments (like command name passed by Docker)
    }

    return { transport: transport.toLowerCase(), port, authToken };
  }

  const options = parseArgs()
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

    const authMode = process.env.AUTH_MODE || 'legacy'

    // Health endpoint (no authentication required)
    app.get('/health', (_req, res) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        transport: 'http',
        port: options.port,
        authMode
      })
    })

    // OAuth provider를 외부에서 참조할 수 있도록 선언
    let oauthProvider: TPCOAuthServerProvider | undefined

    if (authMode === 'oauth') {
      // OAuth mode: Use TPC OAuth server for authentication
      const tpcBaseUrl = process.env.TPC_OAUTH_BASE_URL
      const tpcClientId = process.env.TPC_CLIENT_ID
      const tpcClientSecret = process.env.TPC_CLIENT_SECRET
      const issuerUrl = process.env.ISSUER_URL

      if (!tpcBaseUrl || !tpcClientId || !tpcClientSecret || !issuerUrl) {
        throw new Error('OAuth mode requires TPC_OAUTH_BASE_URL, TPC_CLIENT_ID, TPC_CLIENT_SECRET, and ISSUER_URL environment variables')
      }

      oauthProvider = createTPCOAuthProvider({
        baseUrl: tpcBaseUrl,
        clientId: tpcClientId,
        clientSecret: tpcClientSecret,
        mcpServerUrl: issuerUrl
      })

      const issuer = new URL(issuerUrl)

      // OAuth endpoints (/authorize, /token, /revoke, /.well-known/*)
      app.use(mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl: issuer,
        baseUrl: issuer,
        resourceServerUrl: new URL('/mcp', issuer),
        scopesSupported: [],
        resourceName: 'Notion MCP Server'
      }))

      // TPC OAuth callback 엔드포인트
      // TPC 로그인 후 이 URL로 리다이렉트됨
      app.get('/callback', async (req, res) => {
        try {
          const code = req.query.code as string
          const state = req.query.state as string
          const error = req.query.error as string

          if (error) {
            const errorDescription = req.query.error_description as string || 'Unknown error'
            res.status(400).send(`OAuth error: ${error} - ${errorDescription}`)
            return
          }

          if (!code || !state) {
            res.status(400).send('Missing code or state parameter')
            return
          }

          // Provider의 handleCallback을 호출하여 토큰 교환 및 MCP 클라이언트로 리다이렉트
          const result = await oauthProvider!.handleCallback(code, state)
          res.redirect(result.redirectUrl)
        } catch (error) {
          console.error('OAuth callback error:', error)
          res.status(500).send('OAuth callback failed')
        }
      })

      // Apply OAuth Bearer authentication to /mcp routes
      app.use('/mcp', requireBearerAuth({
        verifier: oauthProvider,
        requiredScopes: []
      }))

      console.log(`OAuth mode enabled with TPC OAuth server: ${tpcBaseUrl}`)
      console.log(`Issuer URL: ${issuerUrl}`)
      console.log(`Callback URL (register this in TPC): ${oauthProvider.callbackUrl}`)
    } else {
      // Legacy mode: Use static bearer token
      const authToken = options.authToken || process.env.AUTH_TOKEN || randomBytes(32).toString('hex')
      if (!options.authToken && !process.env.AUTH_TOKEN) {
        console.log(`Generated auth token: ${authToken}`)
        console.log(`Use this token in the Authorization header: Bearer ${authToken}`)
      }

      // Authorization middleware for legacy mode
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

      // Apply legacy token authentication to /mcp routes
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
      console.log(`Authentication mode: ${authMode}`)
      if (authMode === 'oauth') {
        console.log(`OAuth metadata: http://0.0.0.0:${port}/.well-known/oauth-authorization-server`)
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
