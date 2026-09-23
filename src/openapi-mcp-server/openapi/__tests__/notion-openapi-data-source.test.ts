import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type NotionOpenApiSpec = {
  paths: Record<string, Record<string, { operationId?: string; requestBody?: any }>>
}

function loadSpec(): NotionOpenApiSpec {
  const filename = fileURLToPath(import.meta.url)
  const directory = path.dirname(filename)
  const specPath = path.resolve(directory, '../../../../scripts/notion-openapi.json')
  return JSON.parse(fs.readFileSync(specPath, 'utf-8')) as NotionOpenApiSpec
}

function findOperationPath(spec: NotionOpenApiSpec, operationId: string): { path: string; method: string; operation: any } | null {
  for (const [pathName, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (operation?.operationId === operationId) {
        return { path: pathName, method, operation }
      }
    }
  }
  return null
}

describe('Notion OpenAPI data-source compatibility', () => {
  it('maps create-a-data-source to the databases endpoint', () => {
    const spec = loadSpec()
    const op = findOperationPath(spec, 'create-a-data-source')

    expect(op).not.toBeNull()
    expect(op?.method).toBe('post')
    expect(op?.path).toBe('/v1/databases')
  })

  it('maps update-a-data-source to the databases endpoint', () => {
    const spec = loadSpec()
    const op = findOperationPath(spec, 'update-a-data-source')

    expect(op).not.toBeNull()
    expect(op?.method).toBe('patch')
    expect(op?.path).toBe('/v1/databases/{data_source_id}')
  })

  it('accepts create payload via initial_data_source.properties', () => {
    const spec = loadSpec()
    const op = findOperationPath(spec, 'create-a-data-source')
    const schema = op?.operation?.requestBody?.content?.['application/json']?.schema

    expect(schema).toBeDefined()
    expect(schema.required).toContain('parent')
    expect(schema.required).toContain('initial_data_source')
    expect(schema.required).not.toContain('properties')

    expect(schema.properties.initial_data_source).toBeDefined()
    expect(schema.properties.initial_data_source.type).toBe('object')
    expect(schema.properties.initial_data_source.properties).toBeDefined()
    expect(schema.properties.initial_data_source.properties.properties).toBeDefined()
  })
})
