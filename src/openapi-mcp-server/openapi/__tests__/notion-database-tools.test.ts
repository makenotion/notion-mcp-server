import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'
import type { OpenAPIV3 } from 'openapi-types'
import { OpenAPIToMCPConverter } from '../parser'

/**
 * Guards the create-database tool against the real Notion OpenAPI spec.
 */
describe('Notion create-database tool', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'scripts/notion-openapi.json'), 'utf-8'),
  ) as OpenAPIV3.Document

  const { tools, openApiLookup } = new OpenAPIToMCPConverter(spec).convertToMCPTools()
  const methods = Object.values(tools).flatMap((t) => t.methods)

  it('exposes create-database', () => {
    const tool = methods.find((m) => m.name === 'create-database')
    expect(tool).toBeDefined()
  })

  it('maps create-database to POST /v1/databases', () => {
    const entry = Object.values(openApiLookup).find((op) => op.operationId === 'create-database')
    expect(entry?.method).toBe('post')
    expect(entry?.path).toBe('/v1/databases')
  })
})
