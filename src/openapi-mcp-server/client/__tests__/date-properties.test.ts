import { HttpClient } from '../http-client'
import { OpenAPIV3 } from 'openapi-types'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock console.log and console.warn to capture debug output
const mockConsoleLog = vi.fn()
const mockConsoleWarn = vi.fn()

beforeEach(() => {
  mockConsoleLog.mockClear()
  mockConsoleWarn.mockClear()
  vi.spyOn(console, 'log').mockImplementation(mockConsoleLog)
  vi.spyOn(console, 'warn').mockImplementation(mockConsoleWarn)
})

describe('HttpClient - Date Properties Validation', () => {
  const mockOpenApiSpec: OpenAPIV3.Document = {
    openapi: '3.0.0',
    info: { title: 'Test API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/v1/pages': {
        post: {
          operationId: 'post-page',
          summary: 'Create a page',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['parent', 'properties'],
                  properties: {
                    parent: { type: 'object' },
                    properties: { type: 'object' }
                  }
                }
              }
            }
          },
          responses: { '200': { description: 'Success' } }
        }
      }
    }
  }

  it('should log debug info for date properties in page operations', async () => {
    const httpClient = new HttpClient(
      { baseUrl: 'https://api.example.com' },
      mockOpenApiSpec
    )

    const operation = {
      operationId: 'post-page',
      method: 'post',
      path: '/v1/pages',
      requestBody: mockOpenApiSpec.paths['/v1/pages']!.post!.requestBody,
      responses: {}
    }

    const params = {
      parent: { page_id: 'test-id' },
      'Activity': 'Test Activity',
      'date:TestDate:start': '2025-10-10',
      'date:TestDate:is_datetime': 0
    }

    // Mock the actual HTTP call to avoid network requests
    const mockApi = {
      'post-page': vi.fn().mockResolvedValue({
        data: { success: true },
        status: 200,
        headers: {}
      })
    }

    // Override the api promise in httpClient
    ;(httpClient as any).api = Promise.resolve(mockApi)

    try {
      await httpClient.executeOperation(operation, params)
    } catch (error) {
      // We expect this to potentially fail due to mocking, that's OK
    }

    // Verify that date properties were logged
    expect(mockConsoleLog).toHaveBeenCalledWith(
      '[post-page] Input date properties:',
      expect.arrayContaining(['date:TestDate:start', 'date:TestDate:is_datetime'])
    )
  })

  it('should not log debug info for non-page operations', async () => {
    const httpClient = new HttpClient(
      { baseUrl: 'https://api.example.com' },
      {
        ...mockOpenApiSpec,
        paths: {
          '/v1/users': {
            get: {
              operationId: 'get-users',
              summary: 'Get users',
              responses: { '200': { description: 'Success' } }
            }
          }
        }
      }
    )

    const operation = {
      operationId: 'get-users',
      method: 'get',
      path: '/v1/users',
      responses: {}
    }

    const params = {
      'date:TestDate:start': '2025-10-10'
    }

    const mockApi = {
      'get-users': vi.fn().mockResolvedValue({
        data: { users: [] },
        status: 200,
        headers: {}
      })
    }

    ;(httpClient as any).api = Promise.resolve(mockApi)

    try {
      await httpClient.executeOperation(operation, params)
    } catch (error) {
      // We expect this to potentially fail due to mocking, that's OK
    }

    // Verify that no date property logging occurred for non-page operations
    expect(mockConsoleLog).not.toHaveBeenCalledWith(
      expect.stringContaining('Input date properties')
    )
  })
})