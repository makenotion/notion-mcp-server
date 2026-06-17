import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'
import type { OpenAPIV3 } from 'openapi-types'
import { OpenAPIToMCPConverter } from '../parser'

/**
 * Guards the page-markdown tools against the real Notion OpenAPI spec and
 * verifies that header parameters (Notion-Version) are not exposed as model
 * inputs.
 */
describe('Notion page-markdown tools', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'scripts/notion-openapi.json'), 'utf-8'),
  ) as OpenAPIV3.Document

  const { tools, openApiLookup } = new OpenAPIToMCPConverter(spec).convertToMCPTools()
  const methods = Object.values(tools).flatMap((t) => t.methods)
  const byName = (name: string) => methods.find((m) => m.name === name)

  it('exposes retrieve-page-markdown and update-page-markdown', () => {
    expect(byName('retrieve-page-markdown')).toBeDefined()
    expect(byName('update-page-markdown')).toBeDefined()
  })

  it('maps the markdown tools to the correct HTTP operations', () => {
    const get = Object.entries(openApiLookup).find(([, op]) => op.operationId === 'retrieve-page-markdown')
    const patch = Object.entries(openApiLookup).find(([, op]) => op.operationId === 'update-page-markdown')
    expect(get?.[1].method).toBe('get')
    expect(get?.[1].path).toBe('/v1/pages/{page_id}/markdown')
    expect(patch?.[1].method).toBe('patch')
    expect(patch?.[1].path).toBe('/v1/pages/{page_id}/markdown')
  })

  it('does not expose Notion-Version (a server-managed header) as a tool input', () => {
    for (const method of methods) {
      expect(Object.keys(method.inputSchema.properties ?? {})).not.toContain('Notion-Version')
    }
  })

  it('exposes the expected inputs for the markdown tools', () => {
    const retrieve = byName('retrieve-page-markdown')!
    const retrieveProps = Object.keys(retrieve.inputSchema.properties ?? {})
    expect(retrieveProps).toContain('page_id')
    expect(retrieveProps).toContain('include_transcript')

    const update = byName('update-page-markdown')!
    const updateProps = Object.keys(update.inputSchema.properties ?? {})
    expect(updateProps).toContain('page_id')
    expect(updateProps).toContain('type')
    expect(updateProps).toContain('replace_content')
    expect(updateProps).toContain('update_content')
  })
})
