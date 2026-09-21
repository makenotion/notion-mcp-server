import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, afterAll } from 'vitest'

import { initProxy } from '../init-server'

// A minimal-but-real OpenAPI document is enough to exercise loadOpenApiSpec's
// caching behavior; the contents don't matter, only that parsing it twice
// with the same (specPath, baseUrl) key must not produce two distinct
// objects.
const MINIMAL_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/test': {
      get: {
        operationId: 'getTest',
        responses: { '200': { description: 'Success' } },
      },
    },
  },
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-mcp-init-server-test-'))
const specPath = path.join(tmpDir, 'minimal-openapi.json')
fs.writeFileSync(specPath, JSON.stringify(MINIMAL_SPEC))

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('initProxy', () => {
  it('reuses the same parsed OpenAPI spec object across calls with the same specPath/baseUrl', async () => {
    // openapi-client-axios dereferences the spec document through
    // dereference-json-schema@0.2.1, whose dereferenceSync caches its
    // (expensive) output in a process-lifetime Map keyed by the input
    // object's identity, with no eviction:
    // https://github.com/anttiviljami/dereference-json-schema/blob/b9b9838d9c2ca60cc5d1b1b76a72fddc960f694e/src/dereference.ts#L5
    // If initProxy() ever goes back to re-parsing the spec file fresh on
    // every call, each call produces a new object identity, that cache never
    // hits, and every session leaks a full copy of the dereferenced spec
    // forever. This test pins the invariant that prevents that: repeated
    // calls with the same (specPath, baseUrl) must hand back the exact same
    // parsed spec object.
    const proxyA = await initProxy(specPath, undefined, {})
    const proxyB = await initProxy(specPath, undefined, {})

    const specA = (proxyA as any).httpClient.openApiSpec
    const specB = (proxyB as any).httpClient.openApiSpec

    expect(specA).toBe(specB)
  })

  it('does not share spec objects across different baseUrl overrides', async () => {
    const proxyDefault = await initProxy(specPath, undefined, {})
    const proxyOverridden = await initProxy(specPath, 'https://example.com', {})

    const specDefault = (proxyDefault as any).httpClient.openApiSpec
    const specOverridden = (proxyOverridden as any).httpClient.openApiSpec

    expect(specDefault).not.toBe(specOverridden)
    expect(specOverridden.servers[0].url).toBe('https://example.com')
  })
})
