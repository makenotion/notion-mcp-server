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

type NewToolMethod = {
  name: string
  description: string
  inputSchema: IJsonSchema & { type: 'object' }
  returnSchema?: IJsonSchema
}

type NewToolDefinition = {
  methods: Array<NewToolMethod>
}

// import this class, extend and return server
export class MCPProxy {
  private server: Server
  private httpClient: HttpClient
  private tools: Record<string, NewToolDefinition>
  private toolMethodLookup: Record<string, NewToolMethod>
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

    // Build a lookup for tool methods by their truncated name
    this.toolMethodLookup = {}
    Object.entries(this.tools).forEach(([toolName, def]) => {
      def.methods.forEach(method => {
        const toolNameWithMethod = `${toolName}-${method.name}`
        const truncatedToolName = this.truncateToolName(toolNameWithMethod)
        this.toolMethodLookup[truncatedToolName] = method
      })
    })

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

      // Find the tool method to get the input schema
      const toolMethod = this.toolMethodLookup[name]

      // Coerce parameters to their expected types based on the schema
      const coercedParams = toolMethod
        ? this.coerceParamsToSchemaTypes(params, toolMethod.inputSchema)
        : params

      try {
        // Execute the operation
        const response = await this.httpClient.executeOperation(operation, coercedParams)

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

  /**
   * Coerce parameter values to their expected types based on the JSON schema.
   * This handles cases where MCP protocol sends all values as strings.
   */
  private coerceParamsToSchemaTypes(
    params: Record<string, any> | undefined,
    schema: IJsonSchema & { type: 'object' }
  ): Record<string, any> {
    if (!params || !schema.properties) {
      return params ?? {}
    }

    const coerced: Record<string, any> = { ...params }

    for (const [key, value] of Object.entries(coerced)) {
      if (value === undefined || value === null) continue

      const propSchema = schema.properties[key] as IJsonSchema | undefined
      if (!propSchema) continue

      coerced[key] = this.coerceValue(value, propSchema)
    }

    return coerced
  }

  /**
   * Coerce a single value to its expected type based on the schema.
   */
  private coerceValue(value: any, schema: IJsonSchema): any {
    // Handle $ref - we can't resolve it here, so just return the value as-is
    if ('$ref' in schema) {
      return value
    }

    const schemaType = schema.type

    // Handle integer type
    if (schemaType === 'integer') {
      if (typeof value === 'string') {
        const parsed = parseInt(value, 10)
        return isNaN(parsed) ? value : parsed
      }
      return value
    }

    // Handle number type
    if (schemaType === 'number') {
      if (typeof value === 'string') {
        const parsed = parseFloat(value)
        return isNaN(parsed) ? value : parsed
      }
      return value
    }

    // Handle boolean type
    if (schemaType === 'boolean') {
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true
        if (value.toLowerCase() === 'false') return false
      }
      return value
    }

    // Handle array type
    if (schemaType === 'array' && Array.isArray(value) && schema.items) {
      return value.map(item => this.coerceValue(item, schema.items as IJsonSchema))
    }

    // Handle object type recursively
    if (schemaType === 'object' && typeof value === 'object' && value !== null && schema.properties) {
      const coerced: Record<string, any> = {}
      for (const [k, v] of Object.entries(value)) {
        const propSchema = schema.properties[k] as IJsonSchema | undefined
        coerced[k] = propSchema ? this.coerceValue(v, propSchema) : v
      }
      return coerced
    }

    return value
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
