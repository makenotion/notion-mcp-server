import fs from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { OpenAPIV3 } from 'openapi-types'
import { afterEach, describe, expect, it } from 'vitest'
import { MCPProxy } from '../proxy'

const DEFS_PREFIX = '#/$defs/'

function collectRefs(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith(DEFS_PREFIX)) {
        found.add(value.slice(DEFS_PREFIX.length).split('/')[0]!)
      } else {
        collectRefs(value, found)
      }
    }
  }
}

/** Names of the `$defs` entries a tool's parameters reach, directly or through other definitions. */
function reachableDefs(inputSchema: Record<string, unknown>): Set<string> {
  const { $defs, ...rest } = inputSchema
  const defs = ($defs ?? {}) as Record<string, unknown>
  const reached = new Set<string>()
  const pending = new Set<string>()
  collectRefs(rest, pending)
  while (pending.size > 0) {
    const name = pending.values().next().value as string
    pending.delete(name)
    if (reached.has(name)) continue
    reached.add(name)
    const next = new Set<string>()
    collectRefs(defs[name], next)
    for (const ref of next) if (!reached.has(ref)) pending.add(ref)
  }
  return reached
}

describe('tools/list input schemas for the Notion OpenAPI spec', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'scripts/notion-openapi.json'), 'utf-8'),
  ) as OpenAPIV3.Document

  let client: Client | undefined

  afterEach(async () => {
    await client?.close()
    client = undefined
  })

  async function listTools() {
    const proxy = new MCPProxy('Notion API', spec, { Authorization: 'Bearer test-token' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await proxy.connect(serverTransport)
    client = new Client({ name: 'list-tools-defs-test', version: '1.0.0' })
    await client.connect(clientTransport)
    return (await client.listTools()).tools
  }

  it('lists only the $defs each tool actually references', async () => {
    const tools = await listTools()
    expect(tools.length).toBeGreaterThan(0)

    for (const tool of tools) {
      const schema = tool.inputSchema as Record<string, unknown>
      const declared = Object.keys((schema.$defs ?? {}) as Record<string, unknown>).sort()
      const reached = [...reachableDefs(schema)].sort()
      expect(declared, `$defs of ${tool.name}`).toEqual(reached)
    }
  })

  it('does not attach write-only definitions to read tools', async () => {
    const tools = await listTools()

    for (const name of ['API-retrieve-a-block', 'API-get-block-children', 'API-retrieve-a-page']) {
      const tool = tools.find((candidate) => candidate.name === name)
      expect(tool, name).toBeDefined()
      const defs = Object.keys(((tool!.inputSchema as Record<string, unknown>).$defs ?? {}) as Record<string, unknown>)
      expect(defs, `$defs of ${name}`).not.toContain('blockObjectRequest')
      expect(defs, `$defs of ${name}`).not.toContain('richTextRequest')
      expect(defs, `$defs of ${name}`).not.toContain('parentRequest')
    }
  })

  it('keeps the definitions that write tools reference', async () => {
    const tools = await listTools()
    const appendChildren = tools.find((tool) => tool.name === 'API-patch-block-children')
    expect(appendChildren).toBeDefined()

    const schema = appendChildren!.inputSchema as Record<string, unknown>
    const defs = Object.keys((schema.$defs ?? {}) as Record<string, unknown>)
    expect(defs).toContain('blockObjectRequest')
    expect(JSON.stringify(schema.properties)).toContain('#/$defs/blockObjectRequest')
  })
})
