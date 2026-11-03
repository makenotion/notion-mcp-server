import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { OpenAPIV3 } from 'openapi-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MCPProxy } from '../../mcp/proxy'

const specPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../scripts/notion-openapi.json')

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

describe('native tool registration', () => {
  const client = new Client({ name: 'cold-format-consumer', version: '0.0.0' })
  let tools: Awaited<ReturnType<Client['listTools']>>['tools'] = []

  beforeAll(async () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as OpenAPIV3.Document
    const proxy = new MCPProxy('Notion API', spec, {
      Authorization: 'Bearer cold-test',
      'Notion-Version': '2025-09-03',
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await proxy.connect(serverTransport)
    await client.connect(clientTransport)
    tools = (await client.listTools()).tools
  })

  afterAll(async () => {
    await client.close()
  })

  it('lists shipped tools over the SDK transport with no Notion credential', () => {
    expect(tools.length).toBeGreaterThan(1)
    expect(tools.some((tool) => tool.name === 'API-post-page')).toBe(true)
  })

  it('compiles every listed input schema with the installed SDK validator', () => {
    const validator = new AjvJsonSchemaValidator()
    const warnings: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
    }
    try {
      for (const tool of tools) {
        expect(formatsIn(tool.inputSchema), tool.name).not.toContain('json')
        const check = validator.getValidator(tool.inputSchema)
        expect(typeof check).toBe('function')
      }
    } finally {
      console.warn = original
    }
    expect(warnings.filter((line) => line.includes('unknown format'))).toEqual([])

    const postPage = tools.find((tool) => tool.name === 'API-post-page')
    expect(postPage).toBeTruthy()
    const properties = postPage!.inputSchema.properties as Record<string, { format?: string; description?: string }>
    expect(properties.icon.format).toBeUndefined()
    expect(properties.cover.format).toBeUndefined()
    expect(properties.icon.description).toContain('icon of the new page')
    expect(formatsIn(postPage!.inputSchema)).toContain('uuid')
  })
})
