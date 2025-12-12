import { MCPProxy } from '../proxy'
import { OpenAPIV3 } from 'openapi-types'
import { HttpClient } from '../../client/http-client'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

// Mock the dependencies
vi.mock('../../client/http-client')
vi.mock('@modelcontextprotocol/sdk/server/index.js')

describe('MCPProxy', () => {
  let proxy: MCPProxy
  let mockOpenApiSpec: OpenAPIV3.Document

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Setup minimal OpenAPI spec for testing
    mockOpenApiSpec = {
      openapi: '3.0.0',
      servers: [{ url: 'http://localhost:3000' }],
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
      },
    }

    proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
  })

  describe('listTools handler', () => {
    it('should return converted tools from OpenAPI spec', async () => {
      const server = (proxy as any).server
      const listToolsHandler = server.setRequestHandler.mock.calls[0].filter((x: unknown) => typeof x === 'function')[0]
      const result = await listToolsHandler()

      expect(result).toHaveProperty('tools')
      expect(Array.isArray(result.tools)).toBe(true)
    })

    it('should truncate tool names exceeding 64 characters', async () => {
      // Setup OpenAPI spec with long tool names
      mockOpenApiSpec.paths = {
        '/test': {
          get: {
            operationId: 'a'.repeat(65),
            responses: {
              '200': {
                description: 'Success'
              }
            }
          }
        }
      }
      proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      const server = (proxy as any).server
      const listToolsHandler = server.setRequestHandler.mock.calls[0].filter((x: unknown) => typeof x === 'function')[0];
      const result = await listToolsHandler()

      expect(result.tools[0].name.length).toBeLessThanOrEqual(64)
    })
  })

  describe('callTool handler', () => {
    it('should execute operation and return formatted response', async () => {
      // Mock HttpClient response
      const mockResponse = {
        data: { message: 'success' },
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
        }),
      }
      ;(HttpClient.prototype.executeOperation as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

      // Set up the openApiLookup with our test operation
      ;(proxy as any).openApiLookup = {
        'API-getTest': {
          operationId: 'getTest',
          responses: { '200': { description: 'Success' } },
          method: 'get',
          path: '/test',
        },
      }

      const server = (proxy as any).server
      const handlers = server.setRequestHandler.mock.calls.flatMap((x: unknown[]) => x).filter((x: unknown) => typeof x === 'function')
      const callToolHandler = handlers[1]

      const result = await callToolHandler({
        params: {
          name: 'API-getTest',
          arguments: {},
        },
      })

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: 'success' }),
          },
        ],
      })
    })

    it('should throw error for non-existent operation', async () => {
      const server = (proxy as any).server
      const handlers = server.setRequestHandler.mock.calls.flatMap((x: unknown[]) => x).filter((x: unknown) => typeof x === 'function')
      const callToolHandler = handlers[1]

      await expect(
        callToolHandler({
          params: {
            name: 'nonExistentMethod',
            arguments: {},
          },
        }),
      ).rejects.toThrow('Method nonExistentMethod not found')
    })

    it('should handle tool names exceeding 64 characters', async () => {
      // Mock HttpClient response
      const mockResponse = {
        data: { message: 'success' },
        status: 200,
        headers: new Headers({
          'content-type': 'application/json'
        })
      };
      (HttpClient.prototype.executeOperation as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      // Set up the openApiLookup with a long tool name
      const longToolName = 'a'.repeat(65)
      const truncatedToolName = longToolName.slice(0, 64)
      ;(proxy as any).openApiLookup = {
        [truncatedToolName]: {
          operationId: longToolName,
          responses: { '200': { description: 'Success' } },
          method: 'get',
          path: '/test'
        }
      };

      const server = (proxy as any).server;
      const handlers = server.setRequestHandler.mock.calls.flatMap((x: unknown[]) => x).filter((x: unknown) => typeof x === 'function');
      const callToolHandler = handlers[1];

      const result = await callToolHandler({
        params: {
          name: truncatedToolName,
          arguments: {}
        }
      })

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: 'success' })
          }
        ]
      })
    })
  })

  describe('getContentType', () => {
    it('should return correct content type for different headers', () => {
      const getContentType = (proxy as any).getContentType.bind(proxy)

      expect(getContentType(new Headers({ 'content-type': 'text/plain' }))).toBe('text')
      expect(getContentType(new Headers({ 'content-type': 'application/json' }))).toBe('text')
      expect(getContentType(new Headers({ 'content-type': 'image/jpeg' }))).toBe('image')
      expect(getContentType(new Headers({ 'content-type': 'application/octet-stream' }))).toBe('binary')
      expect(getContentType(new Headers())).toBe('binary')
    })
  })

  describe('coerceParamsToSchemaTypes', () => {
    it('should coerce string to integer', () => {
      const coerceParamsToSchemaTypes = (proxy as any).coerceParamsToSchemaTypes.bind(proxy)

      const schema = {
        type: 'object' as const,
        properties: {
          page_size: { type: 'integer' as const }
        }
      }

      const result = coerceParamsToSchemaTypes({ page_size: '20' }, schema)
      expect(result.page_size).toBe(20)
      expect(typeof result.page_size).toBe('number')
    })

    it('should coerce string to number', () => {
      const coerceParamsToSchemaTypes = (proxy as any).coerceParamsToSchemaTypes.bind(proxy)

      const schema = {
        type: 'object' as const,
        properties: {
          price: { type: 'number' as const }
        }
      }

      const result = coerceParamsToSchemaTypes({ price: '19.99' }, schema)
      expect(result.price).toBe(19.99)
      expect(typeof result.price).toBe('number')
    })

    it('should coerce string to boolean', () => {
      const coerceParamsToSchemaTypes = (proxy as any).coerceParamsToSchemaTypes.bind(proxy)

      const schema = {
        type: 'object' as const,
        properties: {
          active: { type: 'boolean' as const }
        }
      }

      expect(coerceParamsToSchemaTypes({ active: 'true' }, schema).active).toBe(true)
      expect(coerceParamsToSchemaTypes({ active: 'false' }, schema).active).toBe(false)
      expect(coerceParamsToSchemaTypes({ active: 'TRUE' }, schema).active).toBe(true)
    })

    it('should leave string values as-is', () => {
      const coerceParamsToSchemaTypes = (proxy as any).coerceParamsToSchemaTypes.bind(proxy)

      const schema = {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const }
        }
      }

      const result = coerceParamsToSchemaTypes({ query: 'search term' }, schema)
      expect(result.query).toBe('search term')
    })

    it('should handle missing schema properties gracefully', () => {
      const coerceParamsToSchemaTypes = (proxy as any).coerceParamsToSchemaTypes.bind(proxy)

      const schema = {
        type: 'object' as const,
        properties: {}
      }

      const result = coerceParamsToSchemaTypes({ unknown: '123' }, schema)
      expect(result.unknown).toBe('123')
    })

    it('should handle undefined and null params', () => {
      const coerceParamsToSchemaTypes = (proxy as any).coerceParamsToSchemaTypes.bind(proxy)

      const schema = {
        type: 'object' as const,
        properties: {
          value: { type: 'integer' as const }
        }
      }

      expect(coerceParamsToSchemaTypes(undefined, schema)).toEqual({})
      expect(coerceParamsToSchemaTypes({ value: null }, schema).value).toBe(null)
    })

    it('should coerce array items', () => {
      const coerceParamsToSchemaTypes = (proxy as any).coerceParamsToSchemaTypes.bind(proxy)

      const schema = {
        type: 'object' as const,
        properties: {
          ids: {
            type: 'array' as const,
            items: { type: 'integer' as const }
          }
        }
      }

      const result = coerceParamsToSchemaTypes({ ids: ['1', '2', '3'] }, schema)
      expect(result.ids).toEqual([1, 2, 3])
    })

    it('should not coerce invalid numeric strings', () => {
      const coerceParamsToSchemaTypes = (proxy as any).coerceParamsToSchemaTypes.bind(proxy)

      const schema = {
        type: 'object' as const,
        properties: {
          value: { type: 'integer' as const }
        }
      }

      const result = coerceParamsToSchemaTypes({ value: 'not-a-number' }, schema)
      expect(result.value).toBe('not-a-number')
    })
  })

  describe('parseHeadersFromEnv', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should parse valid JSON headers from env', () => {
      process.env.OPENAPI_MCP_HEADERS = JSON.stringify({
        Authorization: 'Bearer token123',
        'X-Custom-Header': 'test',
      })

      const proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer token123',
            'X-Custom-Header': 'test',
          },
        }),
        expect.anything(),
      )
    })

    it('should return empty object when env var is not set', () => {
      delete process.env.OPENAPI_MCP_HEADERS

      const proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {},
        }),
        expect.anything(),
      )
    })

    it('should return empty object and warn on invalid JSON', () => {
      const consoleSpy = vi.spyOn(console, 'warn')
      process.env.OPENAPI_MCP_HEADERS = 'invalid json'

      const proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {},
        }),
        expect.anything(),
      )
      expect(consoleSpy).toHaveBeenCalledWith('Failed to parse OPENAPI_MCP_HEADERS environment variable:', expect.any(Error))
    })

    it('should return empty object and warn on non-object JSON', () => {
      const consoleSpy = vi.spyOn(console, 'warn')
      process.env.OPENAPI_MCP_HEADERS = '"string"'

      const proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {},
        }),
        expect.anything(),
      )
      expect(consoleSpy).toHaveBeenCalledWith('OPENAPI_MCP_HEADERS environment variable must be a JSON object, got:', 'string')
    })

    it('should use NOTION_TOKEN when OPENAPI_MCP_HEADERS is not set', () => {
      delete process.env.OPENAPI_MCP_HEADERS
      process.env.NOTION_TOKEN = 'ntn_test_token_123'

      const proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer ntn_test_token_123',
            'Notion-Version': '2022-06-28'
          },
        }),
        expect.anything(),
      )
    })

    it('should prioritize OPENAPI_MCP_HEADERS over NOTION_TOKEN when both are set', () => {
      process.env.OPENAPI_MCP_HEADERS = JSON.stringify({
        Authorization: 'Bearer custom_token',
        'Custom-Header': 'custom_value',
      })
      process.env.NOTION_TOKEN = 'ntn_test_token_123'

      const proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer custom_token',
            'Custom-Header': 'custom_value',
          },
        }),
        expect.anything(),
      )
    })

    it('should return empty object when neither OPENAPI_MCP_HEADERS nor NOTION_TOKEN are set', () => {
      delete process.env.OPENAPI_MCP_HEADERS
      delete process.env.NOTION_TOKEN

      const proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {},
        }),
        expect.anything(),
      )
    })

    it('should use NOTION_TOKEN when OPENAPI_MCP_HEADERS is empty object', () => {
      process.env.OPENAPI_MCP_HEADERS = '{}'
      process.env.NOTION_TOKEN = 'ntn_test_token_123'

      const proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer ntn_test_token_123',
            'Notion-Version': '2022-06-28'
          },
        }),
        expect.anything(),
      )
    })
  })
  describe('connect', () => {
    it('should connect to transport', async () => {
      const mockTransport = {} as Transport
      await proxy.connect(mockTransport)

      const server = (proxy as any).server
      expect(server.connect).toHaveBeenCalledWith(mockTransport)
    })
  })
})
