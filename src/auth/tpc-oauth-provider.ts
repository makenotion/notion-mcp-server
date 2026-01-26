import { Response } from 'express'
import { OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js'
import { ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { randomBytes } from 'crypto'

export interface TPCOAuthConfig {
  /** TPC OAuth 서버 Base URL (예: https://tpc-agent.tpcground.com) */
  baseUrl: string
  /** TPC에 등록된 이 MCP 서버의 클라이언트 ID */
  clientId: string
  /** TPC에 등록된 이 MCP 서버의 클라이언트 시크릿 */
  clientSecret: string
  /** 이 MCP 서버의 외부 URL (ISSUER_URL) - callback URL 생성에 사용 */
  mcpServerUrl: string
}

export interface TPCUserInfo {
  sub: string
  email: string | null
  name: string
  nickname: string | null
  slackId: string
  slackProfileUrl: string | null
  group: string | null
  team: string | null
  part: string | null
}

/**
 * Authorization flow 중 저장되는 상태 정보
 */
interface PendingAuthorization {
  mcpClientId: string
  mcpRedirectUri: string
  mcpState?: string
  codeChallenge: string
  createdAt: number
}

/**
 * 발급된 authorization code와 매핑된 토큰 정보
 */
interface IssuedCode {
  tpcTokens: OAuthTokens
  mcpClientId: string
  mcpRedirectUri: string
  codeChallenge: string
  createdAt: number
}

/**
 * TPC OAuth 서버를 프록시하는 OAuthServerProvider 구현.
 *
 * MCP 클라이언트의 OAuth 요청을 TPC OAuth 서버로 프록시합니다.
 * TPC OAuth 서버에는 이 MCP 서버의 callback URL이 등록되어야 합니다.
 */
export class TPCOAuthServerProvider implements OAuthServerProvider {
  readonly skipLocalPkceValidation = false  // MCP 서버에서 PKCE 검증

  private config: TPCOAuthConfig
  private _clientsStore: OAuthRegisteredClientsStore

  // 진행 중인 authorization 요청 저장 (state → PendingAuthorization)
  private pendingAuthorizations = new Map<string, PendingAuthorization>()

  // 발급된 authorization code 저장 (code → IssuedCode)
  private issuedCodes = new Map<string, IssuedCode>()

  constructor(config: TPCOAuthConfig, clientsStore?: OAuthRegisteredClientsStore) {
    this.config = config
    this._clientsStore = clientsStore || new DefaultClientsStore()

    // 오래된 항목 정리 (5분마다)
    setInterval(() => this.cleanup(), 5 * 60 * 1000)
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore
  }

  /** MCP 서버의 callback URL */
  get callbackUrl(): string {
    return `${this.config.mcpServerUrl}/callback`
  }

  /**
   * TPC OAuth authorize 엔드포인트로 리다이렉트
   *
   * MCP 클라이언트의 요청 정보를 state에 인코딩하고,
   * TPC에는 이 MCP 서버의 callback URL을 redirect_uri로 전달합니다.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    // 내부 state 생성 (TPC로 전달)
    const internalState = randomBytes(32).toString('hex')

    // MCP 클라이언트의 요청 정보 저장
    this.pendingAuthorizations.set(internalState, {
      mcpClientId: client.client_id,
      mcpRedirectUri: params.redirectUri,
      mcpState: params.state,
      codeChallenge: params.codeChallenge,
      createdAt: Date.now()
    })

    const targetUrl = new URL(`${this.config.baseUrl}/oauth/authorize`)

    // TPC OAuth 서버에 요청
    // - client_id: MCP 서버의 TPC 클라이언트 ID
    // - redirect_uri: MCP 서버의 callback URL (TPC에 등록된 URL)
    // - state: 내부 state (MCP 클라이언트 정보 매핑용)
    const searchParams = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.callbackUrl,
      state: internalState
    })

    // TPC 서버에서 PKCE를 지원하면 전달 (선택적)
    // 참고: TPC 서버가 PKCE를 지원하지 않으면 MCP 서버에서만 검증
    // if (params.codeChallenge) {
    //   searchParams.set('code_challenge', params.codeChallenge)
    //   searchParams.set('code_challenge_method', 'S256')
    // }

    if (params.scopes?.length) {
      searchParams.set('scope', params.scopes.join(' '))
    }

    targetUrl.search = searchParams.toString()
    res.redirect(targetUrl.toString())
  }

  /**
   * TPC callback 처리
   *
   * TPC에서 authorization code를 받아 토큰으로 교환하고,
   * MCP 클라이언트에게 새로운 authorization code를 발급합니다.
   */
  async handleCallback(code: string, state: string): Promise<{ redirectUrl: string }> {
    // 저장된 authorization 정보 조회
    const pending = this.pendingAuthorizations.get(state)
    if (!pending) {
      throw new ServerError('Invalid or expired state')
    }
    this.pendingAuthorizations.delete(state)

    // TPC에서 토큰 교환
    const tpcTokens = await this.exchangeTpcCode(code)

    // MCP 클라이언트용 authorization code 생성
    const mcpCode = randomBytes(32).toString('hex')
    this.issuedCodes.set(mcpCode, {
      tpcTokens,
      mcpClientId: pending.mcpClientId,
      mcpRedirectUri: pending.mcpRedirectUri,
      codeChallenge: pending.codeChallenge,
      createdAt: Date.now()
    })

    // MCP 클라이언트의 redirect_uri로 리다이렉트 URL 생성
    const redirectUrl = new URL(pending.mcpRedirectUri)
    redirectUrl.searchParams.set('code', mcpCode)
    if (pending.mcpState) {
      redirectUrl.searchParams.set('state', pending.mcpState)
    }

    return { redirectUrl: redirectUrl.toString() }
  }

  /**
   * TPC authorization code를 토큰으로 교환 (내부 사용)
   */
  private async exchangeTpcCode(code: string): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.callbackUrl
    })

    const response = await fetch(`${this.config.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new ServerError(`TPC token exchange failed: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    return OAuthTokensSchema.parse(data)
  }

  /**
   * PKCE code_challenge 반환
   */
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const issued = this.issuedCodes.get(authorizationCode)
    if (!issued) {
      throw new ServerError('Invalid authorization code')
    }
    return issued.codeChallenge
  }

  /**
   * MCP 클라이언트의 authorization code를 토큰으로 교환
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    _resource?: URL
  ): Promise<OAuthTokens> {
    const issued = this.issuedCodes.get(authorizationCode)
    if (!issued) {
      throw new ServerError('Invalid or expired authorization code')
    }

    // 검증
    if (issued.mcpClientId !== client.client_id) {
      throw new ServerError('Client ID mismatch')
    }
    if (redirectUri && issued.mcpRedirectUri !== redirectUri) {
      throw new ServerError('Redirect URI mismatch')
    }

    // Code 사용 완료 - 삭제
    this.issuedCodes.delete(authorizationCode)

    // TPC 토큰 반환
    return issued.tpcTokens
  }

  /**
   * Refresh token으로 새 access token 발급
   */
  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken
    })

    if (scopes?.length) {
      params.set('scope', scopes.join(' '))
    }

    const response = await fetch(`${this.config.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new ServerError(`Token refresh failed: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    return OAuthTokensSchema.parse(data)
  }

  /**
   * TPC /oauth/userinfo로 토큰 검증
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const response = await fetch(`${this.config.baseUrl}/oauth/userinfo`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!response.ok) {
      throw new ServerError('Invalid or expired token')
    }

    const userInfo = await response.json() as TPCUserInfo

    return {
      token,
      clientId: this.config.clientId,
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      extra: {
        user: userInfo
      }
    }
  }

  /**
   * 토큰 폐기
   */
  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const params = new URLSearchParams({
      token: request.token,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    })

    if (request.token_type_hint) {
      params.set('token_type_hint', request.token_type_hint)
    }

    const response = await fetch(`${this.config.baseUrl}/oauth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    })

    if (!response.ok) {
      throw new ServerError(`Token revocation failed: ${response.status}`)
    }
  }

  /**
   * 오래된 pending authorization 및 issued code 정리
   */
  private cleanup(): void {
    const now = Date.now()
    const maxAge = 10 * 60 * 1000  // 10분

    for (const [state, pending] of this.pendingAuthorizations) {
      if (now - pending.createdAt > maxAge) {
        this.pendingAuthorizations.delete(state)
      }
    }

    for (const [code, issued] of this.issuedCodes) {
      if (now - issued.createdAt > maxAge) {
        this.issuedCodes.delete(code)
      }
    }
  }
}

/**
 * 기본 MCP 클라이언트 저장소.
 * 동적 클라이언트 등록을 지원합니다.
 */
class DefaultClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>()

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId)
  }

  async registerClient(
    clientMetadata: OAuthClientInformationFull
  ): Promise<OAuthClientInformationFull> {
    const clientId = clientMetadata.client_id || `mcp_client_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const client: OAuthClientInformationFull = {
      ...clientMetadata,
      client_id: clientId
    }

    this.clients.set(clientId, client)
    return client
  }
}

/**
 * TPC OAuth Provider 생성 헬퍼 함수
 */
export function createTPCOAuthProvider(config: TPCOAuthConfig): TPCOAuthServerProvider {
  return new TPCOAuthServerProvider(config)
}
