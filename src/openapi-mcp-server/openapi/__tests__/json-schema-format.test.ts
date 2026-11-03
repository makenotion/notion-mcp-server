import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import type { OpenAPIV3 } from 'openapi-types'
import { describe, expect, it } from 'vitest'

import { OpenAPIToMCPConverter } from '../parser'

const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../scripts')
const sdkRequire = createRequire(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js',
  ),
)

function formatsIn(value: unknown, found: string[] = []): string[] {
  if (!value || typeof value !== 'object') return found
  if (Array.isArray(value)) {
    for (const item of value) formatsIn(item, found)
    return found
  }
  const record = value as Record<string, unknown>
  if (typeof record.format === 'string') found.push(record.format)
  for (const child of Object.values(record)) formatsIn(child, found)
  return found
}

function toolProperties(spec: OpenAPIV3.Document, operationId = 'post-page') {
  const method = new OpenAPIToMCPConverter(spec).convertToMCPTools().tools.API.methods.find((item) => item.name === operationId)
  expect(method).toBeTruthy()
  return method!.inputSchema
}

function bodySpec(body: OpenAPIV3.SchemaObject, components?: OpenAPIV3.ComponentsObject): OpenAPIV3.Document {
  return {
    openapi: '3.0.0',
    info: { title: 'format fixture', version: '1.0.0' },
    components,
    paths: {
      '/pages': {
        post: {
          operationId: 'post-page',
          responses: { '200': { description: 'ok' } },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: body } },
          },
        },
      },
    },
  }
}

describe('OpenAPI format json only', () => {
  it('drops format json, keeps the description, and passes every other format through', () => {
    const schema = toolProperties(
      bodySpec({
        type: 'object',
        properties: {
          icon: { type: 'string', format: 'json', description: 'emoji or file object' },
          parent: { type: 'string', format: 'uuid', nullable: true, description: 'parent id' },
          when: { type: 'string', format: 'date-time' },
          contact: { type: 'string', format: 'email' },
          link: { type: 'string', format: 'uri' },
          position: { type: 'integer', format: 'int32' },
          custom: { type: 'string', format: 'x-vendor-id', description: 'caller format' },
          international: { type: 'string', format: 'idn-email' },
          iri: { type: 'string', format: 'iri' },
        },
      }),
    )
    const properties = schema.properties as Record<string, { format?: string; description?: string; nullable?: boolean }>
    expect(properties.icon.format).toBeUndefined()
    expect(properties.icon.description).toBe('emoji or file object')
    expect(properties.parent.format).toBe('uuid')
    expect(properties.parent.description).toBe('parent id')
    expect(Object.hasOwn(properties.parent, 'nullable')).toBe(false)
    expect(properties.when.format).toBe('date-time')
    expect(properties.contact.format).toBe('email')
    expect(properties.link.format).toBe('uri')
    expect(properties.position.format).toBe('int32')
    expect(properties.custom.format).toBe('x-vendor-id')
    expect(properties.custom.description).toBe('caller format')
    expect(properties.international.format).toBe('idn-email')
    expect(properties.iri.format).toBe('iri')
  })

  it('keeps binary mapped to uri-reference and keeps nested, composed, and ref formats', () => {
    const schema = toolProperties(
      bodySpec(
        {
          type: 'object',
          properties: {
            upload: { type: 'string', format: 'binary', description: 'local file' },
            nested: {
              type: 'object',
              properties: {
                note: { type: 'string', format: 'email', description: 'contact' },
                blob: { type: 'string', format: 'json', description: 'payload' },
              },
            },
            choice: {
              oneOf: [
                { type: 'string', format: 'uuid' },
                { type: 'string', format: 'json', description: 'encoded' },
              ],
            },
            tagged: {
              allOf: [{ type: 'string', format: 'uri', description: 'page link' }],
            },
            alternate: {
              anyOf: [{ type: 'string', format: 'hostname' }],
            },
            widget: { $ref: '#/components/schemas/Widget' },
            encoded: { $ref: '#/components/schemas/Encoded' },
            rows: {
              type: 'array',
              items: { type: 'string', format: 'date-time' },
            },
          },
        },
        {
          schemas: {
            Widget: { type: 'string', format: 'uuid', description: 'id' },
            Encoded: { type: 'string', format: 'json', description: 'raw' },
          },
        },
      ),
    )

    const upload = schema.properties?.upload as { format?: string; description?: string }
    expect(upload.format).toBe('uri-reference')
    expect(upload.description).toContain('local file')
    expect(upload.description).toContain('absolute paths to local files')

    const formats = formatsIn(schema)
    expect(formats).not.toContain('json')
    expect(formats).toContain('email')
    expect(formats).toContain('uuid')
    expect(formats).toContain('uri')
    expect(formats).toContain('uri-reference')
    expect(formats).toContain('date-time')
    expect(formats).toContain('hostname')

    const defs = schema.$defs as Record<string, { format?: string; description?: string }>
    expect(defs.Widget.format).toBe('uuid')
    expect(defs.Widget.description).toBe('id')
    expect(defs.Encoded.format).toBeUndefined()
    expect(defs.Encoded.description).toBe('raw')
  })

  it('omits format json from the shipped post-page tool and keeps uuid', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(specDir, 'notion-openapi.json'), 'utf8')) as OpenAPIV3.Document
    const converted = new OpenAPIToMCPConverter(spec).convertToMCPTools()
    const method = converted.tools.API.methods.find((item) => item.name === 'post-page')
    expect(method).toBeTruthy()
    const formats = formatsIn(method!.inputSchema)
    expect(formats).not.toContain('json')
    expect(formats).toContain('uuid')
    const icon = method!.inputSchema.properties?.icon as { format?: string; description?: string }
    const cover = method!.inputSchema.properties?.cover as { format?: string; description?: string }
    expect(icon.format).toBeUndefined()
    expect(cover.format).toBeUndefined()
    expect(icon.description).toContain('icon of the new page')
    expect(cover.description).toContain('cover image')

    for (const toolMethod of converted.tools.API.methods) {
      expect(formatsIn(toolMethod.inputSchema), toolMethod.name).not.toContain('json')
    }
  })
})

describe('installed MCP SDK validator', () => {
  it('accepts uuid and does not define idn-email, iri, or json', () => {
    const Ajv = sdkRequire('ajv')
    const addFormats = sdkRequire('ajv-formats')
    const ajv = new Ajv.default({ strict: true, allErrors: true, validateFormats: true })
    addFormats.default(ajv)

    expect(() => ajv.compile({ type: 'string', format: 'uuid' })).not.toThrow()
    expect(() => ajv.compile({ type: 'string', format: 'date-time' })).not.toThrow()
    expect(() => ajv.compile({ type: 'string', format: 'idn-email' })).toThrow(/unknown format/)
    expect(() => ajv.compile({ type: 'string', format: 'iri' })).toThrow(/unknown format/)
    expect(() => ajv.compile({ type: 'string', format: 'json' })).toThrow(/unknown format/)
  })
})
