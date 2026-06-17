import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3 } from 'openapi-types'
import { OpenAPIToMCPConverter } from '../parser'

/**
 * Locks the public MCP tool surface generated from the real Notion OpenAPI spec.
 *
 * This is the regression guard for the vendored OpenAPI -> MCP converter: any
 * change that alters tool names, descriptions, the HTTP method (which drives
 * read-only/destructive annotations), or the parameter surface will fail here.
 * If a change is intentional, review the diff and update with `vitest -u`.
 */
describe('Notion OpenAPI spec -> MCP tools (snapshot)', () => {
  const specPath = path.resolve(process.cwd(), 'scripts/notion-openapi.json')
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8')) as OpenAPIV3.Document
  const { tools, openApiLookup } = new OpenAPIToMCPConverter(spec).convertToMCPTools()
  const methods = tools['API']?.methods ?? []

  const summary = methods
    .map((method) => ({
      name: method.name,
      httpMethod: openApiLookup[`API-${method.name}`]?.method,
      description: method.description,
      required: [...(method.inputSchema.required ?? [])].sort(),
      properties: Object.keys(method.inputSchema.properties ?? {}).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  it('generates a stable set of tool names', () => {
    expect(summary.map((tool) => tool.name)).toMatchSnapshot()
  })

  it('generates stable tool definitions (name, method, description, params)', () => {
    expect(summary).toMatchSnapshot()
  })

  it('prefixes every tool description with "Notion | "', () => {
    expect(summary.length).toBeGreaterThan(0)
    for (const tool of summary) {
      expect(tool.description.startsWith('Notion | ')).toBe(true)
    }
  })
})
