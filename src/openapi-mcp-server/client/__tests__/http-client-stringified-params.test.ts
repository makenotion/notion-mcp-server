import { HttpClient } from '../http-client'
import { OpenAPIV3 } from 'openapi-types'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the OpenAPIClientAxios initialization
vi.mock('openapi-client-axios', () => {
  const mockApi = {
    createPage: vi.fn(),
  }
  return {
    default: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(mockApi),
    })),
  }
})

describe('HttpClient - Stringified Parameters', () => {
  let client: HttpClient
  let mockApi: any

  // Spec that mimics Notion's page creation endpoint
  const notionLikeSpec: OpenAPIV3.Document = {
    openapi: '3.0.0',
    info: { title: 'Notion-like API', version: '1.0.0' },
    paths: {
      '/pages': {
        post: {
          operationId: 'createPage',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    parent: {
                      type: 'object',
                      properties: {
                        page_id: { type: 'string' },
                        database_id: { type: 'string' },
                      },
                    },
                    properties: {
                      type: 'object',
                      additionalProperties: true,
                    },
                    children: {
                      type: 'array',
                      items: { type: 'object' },
                    },
                  },
                  required: ['parent'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Page created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  }

  const createPageOperation = {
    ...notionLikeSpec.paths['/pages']?.post,
    method: 'POST',
    path: '/pages',
  } as OpenAPIV3.OperationObject & { method: string; path: string }

  beforeEach(async () => {
    client = new HttpClient({ baseUrl: 'https://api.example.com' }, notionLikeSpec)
    mockApi = await client['api']
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('parses stringified object parameters back to objects', async () => {
    const mockResponse = {
      data: { id: 'page-123', object: 'page' },
      status: 200,
      headers: { 'content-type': 'application/json' },
    }

    mockApi.createPage.mockResolvedValueOnce(mockResponse)

    // Simulate what some MCP clients do - stringify object parameters
    const stringifiedParams = {
      parent: '{"page_id": "264b96fc-8643-8026-8fa9-f90014f08dea"}',
      properties: '{"title": [{"text": {"content": "Test Page"}}]}',
    }

    await client.executeOperation(createPageOperation, stringifiedParams)

    // Verify the parameters were parsed back to objects
    expect(mockApi.createPage).toHaveBeenCalledWith(
      {},
      {
        parent: { page_id: '264b96fc-8643-8026-8fa9-f90014f08dea' },
        properties: { title: [{ text: { content: 'Test Page' } }] },
      },
      expect.any(Object),
    )
  })

  it('handles already-parsed object parameters correctly', async () => {
    const mockResponse = {
      data: { id: 'page-123', object: 'page' },
      status: 200,
      headers: { 'content-type': 'application/json' },
    }

    mockApi.createPage.mockResolvedValueOnce(mockResponse)

    // Parameters already as objects (normal case)
    const objectParams = {
      parent: { page_id: '264b96fc-8643-8026-8fa9-f90014f08dea' },
      properties: { title: [{ text: { content: 'Test Page' } }] },
    }

    await client.executeOperation(createPageOperation, objectParams)

    // Should pass through unchanged
    expect(mockApi.createPage).toHaveBeenCalledWith(
      {},
      {
        parent: { page_id: '264b96fc-8643-8026-8fa9-f90014f08dea' },
        properties: { title: [{ text: { content: 'Test Page' } }] },
      },
      expect.any(Object),
    )
  })

  it('parses stringified array parameters back to arrays', async () => {
    const mockResponse = {
      data: { id: 'page-123', object: 'page' },
      status: 200,
      headers: { 'content-type': 'application/json' },
    }

    mockApi.createPage.mockResolvedValueOnce(mockResponse)

    const stringifiedParams = {
      parent: { page_id: '264b96fc-8643-8026-8fa9-f90014f08dea' },
      children: '[{"type": "paragraph", "paragraph": {"text": "Hello"}}]',
    }

    await client.executeOperation(createPageOperation, stringifiedParams)

    expect(mockApi.createPage).toHaveBeenCalledWith(
      {},
      {
        parent: { page_id: '264b96fc-8643-8026-8fa9-f90014f08dea' },
        children: [{ type: 'paragraph', paragraph: { text: 'Hello' } }],
      },
      expect.any(Object),
    )
  })

  it('leaves non-JSON strings as strings', async () => {
    const mockResponse = {
      data: { id: 'page-123', object: 'page' },
      status: 200,
      headers: { 'content-type': 'application/json' },
    }

    mockApi.createPage.mockResolvedValueOnce(mockResponse)

    const paramsWithInvalidJson = {
      parent: { page_id: '264b96fc-8643-8026-8fa9-f90014f08dea' },
      properties: 'not valid json {{{',
    }

    await client.executeOperation(createPageOperation, paramsWithInvalidJson)

    // Invalid JSON string should be kept as-is
    expect(mockApi.createPage).toHaveBeenCalledWith(
      {},
      {
        parent: { page_id: '264b96fc-8643-8026-8fa9-f90014f08dea' },
        properties: 'not valid json {{{',
      },
      expect.any(Object),
    )
  })
})
