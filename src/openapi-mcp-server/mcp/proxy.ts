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
          tools.push({
            name: truncatedToolName,
            description: method.description,
            inputSchema: method.inputSchema as Tool['inputSchema'],
          })
        })
      })

      return { tools }
    })

    // Handle tool calling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: params } = request.params

      // Find the operation in OpenAPI spec
      const operation = this.findOperation(name)
      if (!operation) {
        throw new Error(`Method ${name} not found`)
      }

      // Fix for nested object parameters being serialized as strings
      // Parse any stringified JSON objects back to objects
      const parsedParams = this.parseNestedObjectParameters(params || {}, name)

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

      // If the schema expects an object but we received a string, try to parse it
      if (paramSchema && typeof paramSchema === 'object' && paramSchema.type === 'object' && typeof value === 'string') {
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
   * Recursively parse nested object values based on schema
   */
  private parseNestedObjectValue(value: any, schema: IJsonSchema | undefined): any {
    if (value === null || value === undefined) {
      return value
    }

    if (typeof value === 'string') {
      // If we have a string but schema expects object, try to parse
      if (schema && typeof schema === 'object' && schema.type === 'object') {
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
      const schemaObj = schema && typeof schema === 'object' && schema.type === 'object' 
        ? (schema as IJsonSchema & { type: 'object' })
        : null
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

  async connect(transport: Transport) {
    // The SDK will handle stdio communication
    await this.server.connect(transport)
  }

  getServer() {
    return this.server
  }
}
