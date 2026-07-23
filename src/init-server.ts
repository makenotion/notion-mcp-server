import fs from 'node:fs'
import path from 'node:path'

import { OpenAPIV3 } from 'openapi-types'
import OpenAPISchemaValidator from 'openapi-schema-validator'

import { MCPProxy } from './openapi-mcp-server/mcp/proxy'

export class ValidationError extends Error {
  constructor(public errors: any[]) {
    super('OpenAPI validation failed')
    this.name = 'ValidationError'
  }
}

// Keyed by specPath+baseUrl and reused across calls so every initProxy() call
// (i.e. every new HTTP session) shares the same parsed spec object identity.
// openapi-client-axios dereferences this document through
// dereference-json-schema@0.2.1, whose dereferenceSync caches its (expensive,
// fully-expanded) output in a process-lifetime Map keyed by the input
// object's identity, with no eviction:
// https://github.com/anttiviljami/dereference-json-schema/blob/b9b9838d9c2ca60cc5d1b1b76a72fddc960f694e/src/dereference.ts#L5
// A fresh JSON.parse() per call defeats that cache on every hit and leaks one
// full dereferenced copy of the spec per session forever.
const specCache = new Map<string, OpenAPIV3.Document>()

async function loadOpenApiSpec(specPath: string, baseUrl: string | undefined): Promise<OpenAPIV3.Document> {
  const cacheKey = `${specPath} ${baseUrl ?? ''}`
  const cached = specCache.get(cacheKey)
  if (cached) {
    return cached
  }

  let rawSpec: string

  try {
    rawSpec = fs.readFileSync(path.resolve(process.cwd(), specPath), 'utf-8')
  } catch (error) {
    console.error('Failed to read OpenAPI specification file:', (error as Error).message)
    process.exit(1)
  }

  // Parse and validate the OpenApi Spec
  try {
    const parsed = JSON.parse(rawSpec)

    // Override baseUrl if specified.
    if (baseUrl) {
      parsed.servers[0].url = baseUrl
    }

    specCache.set(cacheKey, parsed)
    return parsed as OpenAPIV3.Document
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error
    }
    console.error('Failed to parse OpenAPI spec:', (error as Error).message)
    process.exit(1)
  }
}

export async function initProxy(
  specPath: string,
  baseUrl: string | undefined,
  headers?: Record<string, string>,
) {
  const openApiSpec = await loadOpenApiSpec(specPath, baseUrl)
  const proxy = new MCPProxy('Notion API', openApiSpec, headers)

  return proxy
}
