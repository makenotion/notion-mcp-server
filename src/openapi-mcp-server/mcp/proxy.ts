import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, JSONRPCResponse, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js'
import { JSONSchema7 as IJsonSchema } from 'json-schema'
import { OpenAPIToMCPConverter } from '../openapi/parser'
import { HttpClient, HttpClientError } from '../client/http-client'
import { OpenAPIV3 } from 'openapi-types'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

type PathItemObject = OpenAPIV3.PathItemObject & {
  get?: OpenAPIV3.OperationObject
  put?: OpenAPIV3.OperationObject
  post?: OpenAPIV3.OperationObject
  delete?: OpenAPIV3.OperationObject
  patch?: OpenAPIV3.OperationObject
}

type NewToolDefinition = {
  methods: Array<{
    name: string
    description: string
    inputSchema: IJsonSchema & { type: 'object' }
    returnSchema?: IJsonSchema
  }>
}

// import this class, extend and return server
export class MCPProxy {
  private server: Server
  private httpClient: HttpClient
  private tools: Record<string, NewToolDefinition>
  private openApiLookup: Record<string, OpenAPIV3.OperationObject & { method: string; path: string }>

  constructor(name: string, openApiSpec: OpenAPIV3.Document) {
    this.server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {} } })
    const baseUrl = openApiSpec.servers?.[0].url
    if (!baseUrl) {
      throw new Error('No base URL found in OpenAPI spec')
    }
    this.httpClient = new HttpClient(
      {
        baseUrl,
        headers: this.parseHeadersFromEnv(),
      },
      openApiSpec,
    )

    // Convert OpenAPI spec to MCP tools
    const converter = new OpenAPIToMCPConverter(openApiSpec)
    const { tools, openApiLookup } = converter.convertToMCPTools()
    this.tools = tools
    this.openApiLookup = openApiLookup

    this.setupHandlers()
  }

  private setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = []

      // Add methods as separate tools to match the MCP format
      Object.entries(this.tools).forEach(([toolName, def]) => {
        def.methods.forEach(method => {
          const toolNameWithMethod = `${toolName}-${method.name}`;
          const truncatedToolName = this.truncateToolName(toolNameWithMethod);
          
          // Modify inputSchema to accept strings for object parameters
          // This allows validation to pass when nested objects are serialized as strings
          const modifiedSchema = this.makeSchemaAcceptStringifiedObjects(method.inputSchema)
          
          // Debug: Log schema for all tools to see what we're generating
          if (truncatedToolName.includes('page') || truncatedToolName.includes('parent')) {
            console.log('Tool:', truncatedToolName)
            console.log('Modified schema parent property:', JSON.stringify(modifiedSchema.properties?.parent, null, 2))
            console.log('Original schema parent property:', JSON.stringify(method.inputSchema.properties?.parent, null, 2))
          }
          
          tools.push({
            name: truncatedToolName,
            description: method.description,
            inputSchema: modifiedSchema as Tool['inputSchema'],
          })
        })
      })

      return { tools }
    })

    // Handle tool calling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: params } = request.params

      // Debug: Log what we're receiving
      console.log('Received params:', JSON.stringify(params, null, 2))
      console.log('Parent type:', typeof params?.parent, 'Value:', params?.parent)

      // Find the operation in OpenAPI spec
      const operation = this.findOperation(name)
      if (!operation) {
        throw new Error(`Method ${name} not found`)
      }

      // Fix for nested object parameters being serialized as strings
      // Parse any stringified JSON objects back to objects BEFORE validation
      // Note: This parsing happens after MCP SDK validation, so we need to handle
      // the validation error and retry, OR we need to ensure params are already objects
      const parsedParams = this.parseNestedObjectParameters(params || {}, name)
      console.log('Parsed params:', JSON.stringify(parsedParams, null, 2))

      try {
        // Execute the operation
        const response = await this.httpClient.executeOperation(operation, parsedParams)

        // Convert response to MCP format
        return {
          content: [
            {
              type: 'text', // currently this is the only type that seems to be used by mcp server
              text: JSON.stringify(response.data), // TODO: pass through the http status code text?
            },
          ],
        }
      } catch (error) {
        console.error('Error in tool call', error)
        if (error instanceof HttpClientError) {
          console.error('HttpClientError encountered, returning structured error', error)
          const data = error.data?.response?.data ?? error.data ?? {}
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error', // TODO: get this from http status code?
                  ...(typeof data === 'object' ? data : { data: data }),
                }),
              },
            ],
          }
        }
        throw error
      }
    })
  }

  private findOperation(operationId: string): (OpenAPIV3.OperationObject & { method: string; path: string }) | null {
    return this.openApiLookup[operationId] ?? null
  }

  /**
   * Recursively parse stringified JSON objects in parameters.
   * This fixes an issue where nested object parameters are received as strings
   * instead of objects, causing validation errors.
   */
  private parseNestedObjectParameters(
    params: Record<string, any>,
    toolName: string
  ): Record<string, any> {
    const parsed: Record<string, any> = {}
    const inputSchema = this.getInputSchemaForOperation(toolName)

    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) {
        parsed[key] = value
        continue
      }

      // Get the expected schema for this parameter
      const paramSchema = this.getSchemaProperty(inputSchema, key)

      // If we received a string that might be a stringified object, try to parse it
      if (typeof value === 'string' && this.schemaExpectsObject(paramSchema)) {
        try {
          // Try to parse as JSON
          const parsedValue = JSON.parse(value)
          if (typeof parsedValue === 'object' && parsedValue !== null) {
            // Recursively parse nested objects
            parsed[key] = this.parseNestedObjectValue(parsedValue, paramSchema)
          } else {
            // If parsing didn't result in an object, keep original value
            parsed[key] = value
          }
        } catch {
          // If parsing fails, keep original value
          parsed[key] = value
        }
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Recursively parse nested objects
        parsed[key] = this.parseNestedObjectValue(value, paramSchema)
      } else {
        parsed[key] = value
      }
    }

    return parsed
  }

  /**
   * Check if a schema expects an object type, including union types (oneOf/anyOf)
   */
  private schemaExpectsObject(schema: IJsonSchema | undefined): boolean {
    if (!schema || typeof schema !== 'object') {
      return false
    }

    // Direct object type
    if (schema.type === 'object') {
      return true
    }

    // Check oneOf - if any member expects an object
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      return schema.oneOf.some(s => this.schemaExpectsObject(s as IJsonSchema))
    }

    // Check anyOf - if any member expects an object
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      return schema.anyOf.some(s => this.schemaExpectsObject(s as IJsonSchema))
    }

    // Check allOf - if any member expects an object
    if (schema.allOf && Array.isArray(schema.allOf)) {
      return schema.allOf.some(s => this.schemaExpectsObject(s as IJsonSchema))
    }

    return false
  }

  /**
   * Recursively parse nested object values based on schema
   */
  private parseNestedObjectValue(value: any, schema: IJsonSchema | undefined): any {
    if (value === null || value === undefined) {
      return value
    }

    if (typeof value === 'string') {
      // If we have a string but schema expects object, try to parse
      if (this.schemaExpectsObject(schema)) {
        try {
          const parsed = JSON.parse(value)
          if (typeof parsed === 'object' && parsed !== null) {
            return this.parseNestedObjectValue(parsed, schema)
          }
        } catch {
          // Parsing failed, return original
        }
      }
      return value
    }

    if (Array.isArray(value)) {
      const itemsSchema = schema && typeof schema === 'object' && 'items' in schema 
        ? (schema.items as IJsonSchema | undefined)
        : undefined
      return value.map(item => this.parseNestedObjectValue(item, itemsSchema))
    }

    if (typeof value === 'object') {
      const result: Record<string, any> = {}
      // For union types, we can't know which schema to use, so we'll try to match
      // For now, if it's a union type, we'll just recursively parse without strict schema matching
      let schemaObj: IJsonSchema & { type: 'object' } | null = null
      if (schema && typeof schema === 'object') {
        if (schema.type === 'object') {
          schemaObj = schema as IJsonSchema & { type: 'object' }
        } else if (schema.oneOf || schema.anyOf) {
          // For union types, try to find a matching schema or use the first object schema
          const unionSchemas = (schema.oneOf || schema.anyOf) as IJsonSchema[]
          const objectSchema = unionSchemas.find(s => 
            s && typeof s === 'object' && s.type === 'object'
          ) as IJsonSchema & { type: 'object' } | undefined
          if (objectSchema) {
            schemaObj = objectSchema
          }
        }
      }
      
      for (const [key, val] of Object.entries(value)) {
        const propSchema = this.getSchemaProperty(schemaObj, key)
        result[key] = this.parseNestedObjectValue(val, propSchema)
      }
      return result
    }

    return value
  }

  /**
   * Safely get a property from a JSON schema, handling the fact that
   * JSONSchema7Definition can be false or a schema object
   */
  private getSchemaProperty(schema: IJsonSchema & { type: 'object' } | null, key: string): IJsonSchema | undefined {
    if (!schema || !schema.properties) {
      return undefined
    }
    const prop = schema.properties[key]
    if (prop === false) {
      return undefined
    }
    if (typeof prop === 'object') {
      return prop as IJsonSchema
    }
    return undefined
  }

  /**
   * Get the input schema for a given operation by tool name
   */
  private getInputSchemaForOperation(
    toolName: string
  ): IJsonSchema & { type: 'object' } | null {
    // Find the tool definition for this operation
    // Tool names are in format "API-operationId" (e.g., "API-createPage")
    for (const [apiName, toolDef] of Object.entries(this.tools)) {
      // Extract the operationId from the full tool name
      const prefix = `${apiName}-`
      if (toolName.startsWith(prefix)) {
        const operationId = toolName.slice(prefix.length)
        const method = toolDef.methods.find(m => m.name === operationId)
        if (method) {
          return method.inputSchema
        }
      }
    }
    return null
  }

  private parseHeadersFromEnv(): Record<string, string> {
    // First try OPENAPI_MCP_HEADERS (existing behavior)
    const headersJson = process.env.OPENAPI_MCP_HEADERS
    if (headersJson) {
      try {
        const headers = JSON.parse(headersJson)
        if (typeof headers !== 'object' || headers === null) {
          console.warn('OPENAPI_MCP_HEADERS environment variable must be a JSON object, got:', typeof headers)
        } else if (Object.keys(headers).length > 0) {
          // Only use OPENAPI_MCP_HEADERS if it contains actual headers
          return headers
        }
        // If OPENAPI_MCP_HEADERS is empty object, fall through to try NOTION_TOKEN
      } catch (error) {
        console.warn('Failed to parse OPENAPI_MCP_HEADERS environment variable:', error)
        // Fall through to try NOTION_TOKEN
      }
    }

    // Alternative: try NOTION_TOKEN
    const notionToken = process.env.NOTION_TOKEN
    if (notionToken) {
      return {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28'
      }
    }

    return {}
  }

  private getContentType(headers: Headers): 'text' | 'image' | 'binary' {
    const contentType = headers.get('content-type')
    if (!contentType) return 'binary'

    if (contentType.includes('text') || contentType.includes('json')) {
      return 'text'
    } else if (contentType.includes('image')) {
      return 'image'
    }
    return 'binary'
  }

  private truncateToolName(name: string): string {
    if (name.length <= 64) {
      return name;
    }
    return name.slice(0, 64);
  }

  /**
   * Modify a JSON schema to accept both string and object for object-type properties.
   * This allows validation to pass when nested objects are serialized as strings,
   * which we then parse back to objects in the handler.
   */
  private makeSchemaAcceptStringifiedObjects(schema: IJsonSchema & { type: 'object' }): IJsonSchema {
    if (!schema.properties) {
      return schema
    }

    const modified: IJsonSchema = {
      ...schema,
      properties: {},
    }

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (propSchema === false) {
        modified.properties![key] = false
        continue
      }

      const prop = propSchema as IJsonSchema
      
      // If this property expects an object (including union types), make it accept string too
      if (this.schemaExpectsObject(prop)) {
        // For object properties that might come as strings, create a schema that explicitly
        // accepts both string and object types. This allows Zod validation to pass.
        // We'll parse strings to objects in parseNestedObjectParameters
        
        // If it already has a union (oneOf/anyOf), add string to it
        if (prop.oneOf && Array.isArray(prop.oneOf)) {
          modified.properties![key] = {
            ...prop,
            anyOf: [
              { type: 'string' }, // Accept stringified JSON
              ...prop.oneOf, // Keep existing union members
            ],
          }
          // Remove oneOf since we're using anyOf
          delete (modified.properties![key] as any).oneOf
        } else if (prop.anyOf && Array.isArray(prop.anyOf)) {
          modified.properties![key] = {
            ...prop,
            anyOf: [
              { type: 'string' }, // Accept stringified JSON
              ...prop.anyOf, // Keep existing union members
            ],
          }
        } else {
          // No existing union - create one with string and the original schema
          modified.properties![key] = {
            anyOf: [
              { type: 'string' }, // Accept stringified JSON
              prop, // Accept the original object schema
            ],
            description: prop.description || 'Accepts string (JSON) or object',
          }
        }
      } else {
        // For non-object properties, keep as-is
        modified.properties![key] = prop
      }
    }

    return modified
  }

  async connect(transport: Transport) {
    // The SDK will handle stdio communication
    await this.server.connect(transport)
  }

  getServer() {
    return this.server
  }
}
