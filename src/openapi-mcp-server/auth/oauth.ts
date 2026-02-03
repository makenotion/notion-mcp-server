import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { URL, URLSearchParams } from 'node:url'
import { randomBytes, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import open from 'open'

// Notion OAuth configuration
const NOTION_OAUTH_AUTHORIZE_URL = 'https://api.notion.com/v1/oauth/authorize'
const NOTION_OAUTH_TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
const DEFAULT_REDIRECT_PORT = 9876
const DEFAULT_REDIRECT_URI = `http://localhost:${DEFAULT_REDIRECT_PORT}/callback`

// Token storage location
const CONFIG_DIR = path.join(os.homedir(), '.config', 'notion-mcp')
const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json')

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri?: string
  port?: number
}

export interface TokenData {
  access_token: string
  token_type: string
  bot_id: string
  workspace_id: string
  workspace_name?: string
  workspace_icon?: string
  owner?: {
    type: string
    user?: {
      id: string
      name: string
      avatar_url?: string
    }
  }
  duplicated_template_id?: string
  expires_at?: number // Unix timestamp when token expires (if applicable)
  created_at: number // Unix timestamp when token was obtained
}

/**
 * Generates a PKCE code verifier and challenge
 */
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * Ensures the config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
}

/**
 * Loads stored token from disk
 */
export function loadStoredToken(): TokenData | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf-8')
      const token = JSON.parse(data) as TokenData

      // Check if token has expired (if expiration is tracked)
      if (token.expires_at && Date.now() > token.expires_at) {
        console.log('Stored token has expired, will need to re-authenticate')
        return null
      }

      return token
    }
  } catch (error) {
    console.error('Error loading stored token:', error)
  }
  return null
}

/**
 * Saves token to disk
 */
function saveToken(token: TokenData): void {
  ensureConfigDir()
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 })
  console.log(`Token saved to ${TOKEN_FILE}`)
}

/**
 * Clears stored token
 */
export function clearStoredToken(): void {
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE)
    console.log('Stored token cleared')
  }
}

/**
 * Exchanges authorization code for access token
 */
async function exchangeCodeForToken(
  code: string,
  config: OAuthConfig,
  codeVerifier?: string
): Promise<TokenData> {
  const redirectUri = config.redirectUri || DEFAULT_REDIRECT_URI

  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }

  if (codeVerifier) {
    body.code_verifier = codeVerifier
  }

  // Notion uses Basic auth with client_id:client_secret
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')

  const response = await fetch(NOTION_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
  }

  const tokenData = await response.json() as Omit<TokenData, 'created_at'>

  return {
    ...tokenData,
    created_at: Date.now(),
  }
}

/**
 * Starts local callback server and initiates OAuth flow
 */
export async function initiateOAuthFlow(config: OAuthConfig): Promise<TokenData> {
  const port = config.port || DEFAULT_REDIRECT_PORT
  const redirectUri = config.redirectUri || `http://localhost:${port}/callback`

  // Generate PKCE challenge
  const pkce = generatePKCE()

  // Generate state for CSRF protection
  const state = randomBytes(16).toString('hex')

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`)

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Authorization Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          reject(new Error(`OAuth error: ${error}`))
          return
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Security Error</h1>
                <p>State mismatch - possible CSRF attack.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          reject(new Error('State mismatch - possible CSRF attack'))
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Missing Authorization Code</h1>
                <p>No authorization code received.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          reject(new Error('No authorization code received'))
          return
        }

        try {
          // Exchange code for token
          const tokenData = await exchangeCodeForToken(code, config, pkce.verifier)

          // Save token
          saveToken(tokenData)

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>✅ Authorization Successful!</h1>
                <p>Connected to workspace: <strong>${tokenData.workspace_name || tokenData.workspace_id}</strong></p>
                <p>You can close this window and return to the terminal.</p>
                <script>setTimeout(() => window.close(), 3000)</script>
              </body>
            </html>
          `)

          server.close()
          resolve(tokenData)
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Token Exchange Failed</h1>
                <p>${(error as Error).message}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          reject(error)
        }
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    server.listen(port, '127.0.0.1', () => {
      console.log(`OAuth callback server listening on port ${port}`)

      // Build authorization URL
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
        owner: 'user', // Request user-level access
      })

      const authUrl = `${NOTION_OAUTH_AUTHORIZE_URL}?${params.toString()}`

      console.log('\n🔐 Opening browser for Notion authorization...')
      console.log(`If browser doesn't open, visit: ${authUrl}\n`)

      // Open browser
      open(authUrl).catch(() => {
        console.log('Could not open browser automatically.')
        console.log(`Please visit this URL to authorize: ${authUrl}`)
      })
    })

    server.on('error', (error) => {
      reject(new Error(`Failed to start callback server: ${error.message}`))
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close()
      reject(new Error('OAuth flow timed out after 5 minutes'))
    }, 5 * 60 * 1000)
  })
}

/**
 * Gets a valid Notion token, either from storage or by initiating OAuth flow
 */
export async function getNotionToken(config?: OAuthConfig): Promise<string> {
  // First check environment variable
  if (process.env.NOTION_TOKEN) {
    return process.env.NOTION_TOKEN
  }

  // Check for stored OAuth token
  const storedToken = loadStoredToken()
  if (storedToken) {
    console.log(`Using stored OAuth token for workspace: ${storedToken.workspace_name || storedToken.workspace_id}`)
    return storedToken.access_token
  }

  // If no config provided, check for OAuth credentials in env
  if (!config) {
    const clientId = process.env.NOTION_OAUTH_CLIENT_ID
    const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET

    if (clientId && clientSecret) {
      config = { clientId, clientSecret }
    } else {
      throw new Error(
        'No Notion token found. Either:\n' +
        '  1. Set NOTION_TOKEN environment variable with an integration token, or\n' +
        '  2. Set NOTION_OAUTH_CLIENT_ID and NOTION_OAUTH_CLIENT_SECRET for OAuth flow, or\n' +
        '  3. Run with --oauth flag and provide OAuth credentials'
      )
    }
  }

  // Initiate OAuth flow
  console.log('No stored token found, initiating OAuth flow...')
  const tokenData = await initiateOAuthFlow(config)
  return tokenData.access_token
}
