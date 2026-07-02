import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3 } from 'openapi-types'

/**
 * Every Notion API operation must declare the shared Notion-Version header
 * parameter so HttpClient.buildDefaultHeaders() can attach the version.
 */
describe('Notion OpenAPI spec Notion-Version coverage', () => {
  const spec = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'scripts/notion-openapi.json'), 'utf-8'),
  ) as OpenAPIV3.Document

  const notionVersionRef = '#/components/parameters/notionVersion'

  function hasNotionVersionParameter(operation: OpenAPIV3.OperationObject): boolean {
    return (operation.parameters ?? []).some((param) => {
      if ('$ref' in param) {
        return param.$ref === notionVersionRef
      }
      return param.in === 'header' && param.name === 'Notion-Version'
    })
  }

  it('declares Notion-Version on every operation', () => {
    const missing: string[] = []

    for (const [pathKey, pathItem] of Object.entries(spec.paths ?? {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const operation = pathItem?.[method]
        if (!operation?.operationId) {
          continue
        }
        if (!hasNotionVersionParameter(operation)) {
          missing.push(`${method.toUpperCase()} ${pathKey} (${operation.operationId})`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})
