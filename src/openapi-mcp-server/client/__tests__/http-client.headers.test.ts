import { describe, it, expect, afterEach } from 'vitest'
import express, { type Express } from 'express'
import type { Server } from 'http'
import type { OpenAPIV3 } from 'openapi-types'
import { HttpClient } from '../http-client'
import { startTestServer, stopTestServer } from './test-server'

/**
 * Verifies that Notion-Version is sourced per-operation from the OpenAPI spec
 * (server-managed header), so endpoints can pin the API version they require
 * while still letting an explicitly-configured header win.
 */
describe('HttpClient server-managed header parameters', () => {
  let server: Server | undefined

  afterEach(async () => {
    await stopTestServer(server)
    server = undefined
  })

  function echoApp(): Express {
    const app = express()
    app.use(express.json())
    app.get('/v1/legacy', (req, res) => {
      res.json({ version: req.headers['notion-version'] ?? null })
    })
    app.get('/v1/markdown', (req, res) => {
      res.json({ version: req.headers['notion-version'] ?? null })
    })
    return app
  }

  function spec(baseUrl: string): OpenAPIV3.Document {
    return {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      servers: [{ url: baseUrl }],
      components: {
        parameters: {
          notionVersion: {
            name: 'Notion-Version',
            in: 'header',
            required: false,
            schema: { type: 'string', default: '2025-09-03' },
          },
        },
      },
      paths: {
        '/v1/legacy': {
          get: {
            operationId: 'legacyOp',
            // References the shared component default (2025-09-03)
            parameters: [{ $ref: '#/components/parameters/notionVersion' } as any],
            responses: { '200': { description: 'ok' } },
          },
        },
        '/v1/markdown': {
          get: {
            operationId: 'markdownOp',
            // Inline override pinning a newer version (2026-03-11)
            parameters: [
              { name: 'Notion-Version', in: 'header', required: true, schema: { type: 'string', default: '2026-03-11' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
  }

  it('sends each operation’s spec-default Notion-Version', async () => {
    let baseUrl: string
    ;({ server, baseUrl } = await startTestServer(echoApp()))
    const s = spec(baseUrl)
    const client = new HttpClient({ baseUrl }, s)

    const legacy = await client.executeOperation(s.paths!['/v1/legacy']!.get as any)
    const markdown = await client.executeOperation(s.paths!['/v1/markdown']!.get as any)

    expect(legacy.data.version).toBe('2025-09-03')
    expect(markdown.data.version).toBe('2026-03-11')
  })

  it('lets an explicitly-configured Notion-Version win over spec defaults', async () => {
    let baseUrl: string
    ;({ server, baseUrl } = await startTestServer(echoApp()))
    const s = spec(baseUrl)
    const client = new HttpClient(
      { baseUrl, headers: { 'Notion-Version': '2022-06-28' } },
      s,
    )

    const legacy = await client.executeOperation(s.paths!['/v1/legacy']!.get as any)
    expect(legacy.data.version).toBe('2022-06-28')
  })
})
