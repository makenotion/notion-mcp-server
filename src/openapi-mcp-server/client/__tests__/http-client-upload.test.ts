import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OpenAPIV3 } from 'openapi-types'
import fs from 'fs'
import { HttpClient } from '../http-client'

const { uploadFile } = vi.hoisted(() => ({ uploadFile: vi.fn() }))

vi.mock('fs')
vi.mock('openapi-client-axios', () => ({
  default: class {
    init() {
      return Promise.resolve({ uploadFile })
    }
  },
}))

describe('HttpClient file upload rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const binary: OpenAPIV3.SchemaObject = { type: 'string', format: 'binary' }

  it.each<{
    name: string
    properties: Record<string, OpenAPIV3.SchemaObject>
    params: Record<string, unknown>
  }>([
    {
      name: 'an absolute local path',
      properties: { file: binary },
      params: { file: '/outside/secret.txt' },
    },
    {
      name: 'a relative local path',
      properties: { file: binary },
      params: { file: '../../secret.txt' },
    },
    {
      name: 'an array of local paths',
      properties: { files: { type: 'array', items: binary } },
      params: { files: ['/outside/first.txt', '/outside/second.txt'] },
    },
    {
      name: 'multiple file fields',
      properties: { first: binary, second: binary },
      params: { first: '/outside/first.txt', second: '/outside/second.txt' },
    },
  ])('rejects $name before opening files or sending a request', async ({ properties, params }) => {
    const operation: OpenAPIV3.OperationObject & { method: string; path: string } = {
      operationId: 'uploadFile',
      method: 'post',
      path: '/upload',
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: { type: 'object', properties },
          },
        },
      },
      responses: { '200': { description: 'OK' } },
    }
    const spec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: { '/upload': { post: operation } },
    }
    const client = new HttpClient({ baseUrl: 'http://test.com' }, spec)

    await expect(client.executeOperation(operation, params)).rejects.toThrow(
      'File uploads are not supported: local file access is disabled',
    )

    expect(fs.createReadStream).not.toHaveBeenCalled()
    expect(fs.readFile).not.toHaveBeenCalled()
    expect(fs.readFileSync).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })
})
