import { OpenAPIToMCPConverter } from '../parser'
import { OpenAPIV3 } from 'openapi-types'
import { describe, expect, it } from 'vitest'

const jsonBody = (properties: Record<string, OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>): OpenAPIV3.RequestBodyObject => ({
  content: {
    'application/json': {
      schema: { type: 'object', properties },
    },
  },
})

const ok: OpenAPIV3.ResponsesObject = { '200': { description: 'Success' } }

function defsOf(spec: OpenAPIV3.Document): Record<string, string[]> {
  const { tools } = new OpenAPIToMCPConverter(spec).convertToMCPTools()
  const result: Record<string, string[]> = {}
  for (const method of tools['API']!.methods) {
    result[method.name] = Object.keys(method.inputSchema.$defs ?? {}).sort()
  }
  return result
}

describe('OpenAPIToMCPConverter - $defs in tool input schemas', () => {
  it('keeps only the component schemas a tool can reach through its parameters', () => {
    const spec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Defs API', version: '1.0.0' },
      paths: {
        '/roots': {
          post: {
            operationId: 'createRoot',
            requestBody: jsonBody({ root: { $ref: '#/components/schemas/Root' } }),
            responses: ok,
          },
        },
        '/ping': {
          get: {
            operationId: 'ping',
            responses: ok,
          },
        },
        '/others': {
          post: {
            operationId: 'createOther',
            requestBody: jsonBody({ other: { $ref: '#/components/schemas/Other' } }),
            responses: ok,
          },
        },
      },
      components: {
        schemas: {
          Leaf: { type: 'string' },
          Branch: { type: 'object', properties: { leaf: { $ref: '#/components/schemas/Leaf' } } },
          Root: { type: 'object', properties: { branch: { $ref: '#/components/schemas/Branch' } } },
          Other: { type: 'object', properties: { name: { type: 'string' } } },
          Orphan: { type: 'object', properties: { never: { type: 'string' } } },
        },
      },
    }

    expect(defsOf(spec)).toEqual({
      createRoot: ['Branch', 'Leaf', 'Root'],
      ping: [],
      createOther: ['Other'],
    })
  })

  it('terminates on cyclic components and still drops the unreferenced ones', () => {
    const spec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Cycle API', version: '1.0.0' },
      paths: {
        '/nodes': {
          post: {
            operationId: 'createNode',
            requestBody: jsonBody({ node: { $ref: '#/components/schemas/A' } }),
            responses: ok,
          },
        },
      },
      components: {
        schemas: {
          A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
          B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
          Orphan: { type: 'object', properties: { never: { type: 'string' } } },
        },
      },
    }

    expect(defsOf(spec)).toEqual({ createNode: ['A', 'B'] })
  })

  it('follows references held in oneOf, anyOf, allOf, array items, additionalProperties and parameters', () => {
    const spec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Shapes API', version: '1.0.0' },
      paths: {
        '/things/{thing_id}': {
          post: {
            operationId: 'updateThing',
            parameters: [
              { name: 'thing_id', in: 'path', required: true, schema: { type: 'string' } },
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'array', items: { $ref: '#/components/schemas/FilterItem' } },
              },
            ],
            requestBody: jsonBody({
              choice: {
                oneOf: [{ $ref: '#/components/schemas/ChoiceX' }, { $ref: '#/components/schemas/ChoiceY' }],
              },
              either: {
                anyOf: [{ $ref: '#/components/schemas/EitherP' }, { type: 'string' }],
              },
              both: {
                allOf: [{ $ref: '#/components/schemas/BothQ' }],
              },
              list: { type: 'array', items: { $ref: '#/components/schemas/ListItem' } },
              map: { type: 'object', additionalProperties: { $ref: '#/components/schemas/MapValue' } },
            }),
            responses: ok,
          },
        },
      },
      components: {
        schemas: {
          FilterItem: { type: 'object', properties: { name: { type: 'string' } } },
          ChoiceX: { type: 'object', properties: { x: { type: 'string' } } },
          ChoiceY: { type: 'object', properties: { y: { type: 'string' } } },
          EitherP: { type: 'object', properties: { p: { type: 'string' } } },
          BothQ: { type: 'object', properties: { q: { type: 'string' } } },
          ListItem: { type: 'object', properties: { item: { type: 'string' } } },
          MapValue: { type: 'object', properties: { value: { type: 'string' } } },
          Orphan: { type: 'object', properties: { never: { type: 'string' } } },
        },
      },
    }

    expect(defsOf(spec)).toEqual({
      updateThing: ['BothQ', 'ChoiceX', 'ChoiceY', 'EitherP', 'FilterItem', 'ListItem', 'MapValue'],
    })
  })

  it('does not change the shape of the definitions it keeps', () => {
    const spec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Shape API', version: '1.0.0' },
      paths: {
        '/roots': {
          post: {
            operationId: 'createRoot',
            requestBody: jsonBody({ root: { $ref: '#/components/schemas/Root' } }),
            responses: ok,
          },
        },
      },
      components: {
        schemas: {
          Root: {
            type: 'object',
            required: ['title'],
            properties: { title: { type: 'string', description: 'The title' } },
          },
          Orphan: { type: 'string' },
        },
      },
    }

    const { tools } = new OpenAPIToMCPConverter(spec).convertToMCPTools()
    const inputSchema = tools['API']!.methods[0]!.inputSchema

    expect(inputSchema.$defs).toEqual({
      Root: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string', description: 'The title' } },
        additionalProperties: true,
      },
    })
    expect(inputSchema.properties).toEqual({
      root: { anyOf: [{ $ref: '#/$defs/Root' }, { type: 'string' }] },
    })
  })
})
