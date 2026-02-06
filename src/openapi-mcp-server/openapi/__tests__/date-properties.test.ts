import { OpenAPIToMCPConverter } from '../parser'
import { OpenAPIV3 } from 'openapi-types'
import { describe, expect, it } from 'vitest'

describe('OpenAPIToMCPConverter - Date Properties Fix', () => {
  it('should allow additional properties in properties field for post-page operation', () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/v1/pages': {
          post: {
            operationId: 'post-page',
            summary: 'Create a page',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['parent', 'properties'],
                    properties: {
                      parent: {
                        type: 'object',
                        properties: {
                          page_id: { type: 'string', format: 'uuid' }
                        },
                        required: ['page_id']
                      },
                      properties: {
                        type: 'object',
                        properties: {
                          title: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                text: {
                                  type: 'object',
                                  properties: {
                                    content: { type: 'string' }
                                  },
                                  required: ['content']
                                }
                              },
                              required: ['text']
                            }
                          }
                        },
                        additionalProperties: false, // This is the problem we're fixing
                        required: ['title']
                      }
                    }
                  }
                }
              }
            },
            responses: {}
          }
        }
      }
    }

    const converter = new OpenAPIToMCPConverter(mockSpec)
    const { tools } = converter.convertToMCPTools()
    
    const apiTool = tools['API']
    expect(apiTool).toBeDefined()
    
    const postPageMethod = apiTool.methods.find(m => m.name === 'post-page')
    expect(postPageMethod).toBeDefined()
    
    // Verify that the properties field allows additional properties
    const propertiesSchema = postPageMethod!.inputSchema.properties!['properties']
    expect(propertiesSchema).toBeDefined()
    if (typeof propertiesSchema === 'object' && propertiesSchema !== null) {
      expect(propertiesSchema.type).toBe('object')
      expect(propertiesSchema.additionalProperties).toBe(true) // This should be true after our fix
    }
  })

  it('should allow additional properties in properties field for patch-page operation', () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/v1/pages/{page_id}': {
          patch: {
            operationId: 'patch-page',
            summary: 'Update page properties',
            parameters: [
              {
                name: 'page_id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              }
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      properties: {
                        type: 'object',
                        properties: {
                          title: {
                            type: 'array',
                            items: { type: 'string' }
                          }
                        },
                        additionalProperties: false // This should be overridden to true
                      }
                    }
                  }
                }
              }
            },
            responses: {}
          }
        }
      }
    }

    const converter = new OpenAPIToMCPConverter(mockSpec)
    const { tools } = converter.convertToMCPTools()
    
    const apiTool = tools['API']
    expect(apiTool).toBeDefined()
    
    const patchPageMethod = apiTool.methods.find(m => m.name === 'patch-page')
    expect(patchPageMethod).toBeDefined()
    
    // Verify that the properties field allows additional properties
    const propertiesSchema = patchPageMethod!.inputSchema.properties!['properties']
    expect(propertiesSchema).toBeDefined()
    if (typeof propertiesSchema === 'object' && propertiesSchema !== null) {
      expect(propertiesSchema.type).toBe('object')
      expect(propertiesSchema.additionalProperties).toBe(true) // This should be true after our fix
    }
  })

  it('should not affect other operations - additionalProperties should remain as defined', () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/v1/users': {
          get: {
            operationId: 'get-users',
            summary: 'List users',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      properties: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' }
                        },
                        additionalProperties: false // This should remain false for non-page operations
                      }
                    }
                  }
                }
              }
            },
            responses: {}
          }
        }
      }
    }

    const converter = new OpenAPIToMCPConverter(mockSpec)
    const { tools } = converter.convertToMCPTools()
    
    const apiTool = tools['API']
    expect(apiTool).toBeDefined()
    
    const getUsersMethod = apiTool.methods.find(m => m.name === 'get-users')
    expect(getUsersMethod).toBeDefined()
    
    // Verify that non-page operations are not affected by our fix
    const propertiesSchema = getUsersMethod!.inputSchema.properties!['properties']
    expect(propertiesSchema).toBeDefined()
    if (typeof propertiesSchema === 'object' && propertiesSchema !== null) {
      expect(propertiesSchema.type).toBe('object')
      expect(propertiesSchema.additionalProperties).toBe(false) // Should remain false for non-page operations
    }
  })
})