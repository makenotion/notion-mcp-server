import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3 } from 'openapi-types'
import type { JSONSchema7 } from 'json-schema'
import { OpenAPIToMCPConverter } from '../parser'

/**
 * Agents choose tool arguments from the parameter descriptions, so a parameter
 * the model must supply should never be left undescribed.
 */
describe('Notion OpenAPI spec -> MCP tools (parameter descriptions)', () => {
  const specPath = path.resolve(process.cwd(), 'scripts/notion-openapi.json')
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8')) as OpenAPIV3.Document
  const { tools } = new OpenAPIToMCPConverter(spec).convertToMCPTools()
  const methods = tools['API']?.methods ?? []

  const hasText = (schema: JSONSchema7): boolean => typeof schema.description === 'string' && schema.description.trim() !== ''

  // Object and array parameters are wrapped in `anyOf` so they also accept a JSON string,
  // which leaves the description on the first member of the wrapper.
  const isDescribed = (schema: JSONSchema7): boolean =>
    hasText(schema) || (schema.anyOf ?? []).some((member) => typeof member === 'object' && hasText(member))

  const parameters = methods.flatMap((method) =>
    Object.entries(method.inputSchema.properties ?? {}).map(([name, schema]) => ({
      tool: method.name,
      name,
      required: (method.inputSchema.required ?? []).includes(name),
      schema: schema as JSONSchema7,
    })),
  )

  it('describes every required parameter', () => {
    const undescribed = parameters.filter((p) => p.required && !isDescribed(p.schema)).map((p) => `${p.tool}.${p.name}`)
    expect(undescribed).toEqual([])
  })

  it('describes the pagination parameters', () => {
    const pagination = parameters.filter((p) => p.name === 'start_cursor' || p.name === 'page_size')
    expect(pagination.length).toBeGreaterThan(0)

    const undescribed = pagination.filter((p) => !isDescribed(p.schema)).map((p) => `${p.tool}.${p.name}`)
    expect(undescribed).toEqual([])
  })
})
