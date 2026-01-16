import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, JSONRPCResponse, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js'
import { JSONSchema7 as IJsonSchema } from 'json-schema'
import { OpenAPIToMCPConverter } from '../openapi/parser'
import { HttpClient, HttpClientError } from '../client/http-client'
import { OpenAPIV3 } from 'openapi-types'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { NotionResponseFormatter } from '../formatters'
import type { ToolFilterConfig } from '../types/filter-config'

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
  private responseFormatter: NotionResponseFormatter

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

    const filterConfig = this.parseFilterConfigFromEnv()
    const converter = new OpenAPIToMCPConverter(openApiSpec, filterConfig)
    const { tools, openApiLookup } = converter.convertToMCPTools()
    this.tools = tools
    this.openApiLookup = openApiLookup

    this.responseFormatter = new NotionResponseFormatter()

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

          // Look up the HTTP method to determine annotations
          const operation = this.openApiLookup[toolNameWithMethod];
          const httpMethod = operation?.method?.toLowerCase();
          const isReadOnly = httpMethod === 'get';

          tools.push({
            name: truncatedToolName,
            description: method.description,
            inputSchema: method.inputSchema as Tool['inputSchema'],
            annotations: {
              title: this.operationIdToTitle(method.name),
              ...(isReadOnly
                ? { readOnlyHint: true }
                : { destructiveHint: true }),
            },
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

      try {
        // Check for filter_properties usage and prepare warning
        const filterPropertiesWarning = this.getFilterPropertiesWarning(params)

        // Execute the operation
        const response = await this.httpClient.executeOperation(operation, params)

        // Format the response data
        const formattedText = this.responseFormatter.formatResponse(
          operation.operationId || '',
          operation.method,
          operation.path,
          response.data
        )

        // Combine warning with formatted response if applicable
        const finalText = filterPropertiesWarning
          ? `${filterPropertiesWarning}\n\n${formattedText}`
          : formattedText

        // Convert response to MCP format
        return {
          content: [
            {
              type: 'text',
              text: finalText,
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

  private getFilterPropertiesWarning(params: Record<string, any> | undefined): string | null {
    if (!params || !params.filter_properties) {
      return null
    }

    const filterProps = params.filter_properties
    const propsDescription = Array.isArray(filterProps)
      ? filterProps.join(', ')
      : String(filterProps)

    return `[Note: filter_properties=[${propsDescription}] limits returned properties, not which pages match. Use 'filter' to filter pages.]`
  }

  private parseFilterConfigFromEnv(): ToolFilterConfig | undefined {
    const include = process.env.NOTION_MCP_TOOLS_INCLUDE
    const exclude = process.env.NOTION_MCP_TOOLS_EXCLUDE
    const resourceTypes = process.env.NOTION_MCP_RESOURCE_TYPES

    if (!include && !exclude && !resourceTypes) {
      return undefined
    }

    const config: ToolFilterConfig = {}

    if (include) {
      config.include = include.split(',').map(s => s.trim()).filter(s => s.length > 0)
    }

    if (exclude) {
      config.exclude = exclude.split(',').map(s => s.trim()).filter(s => s.length > 0)
    }

    if (resourceTypes) {
      config.resourceTypes = resourceTypes.split(',').map(s => s.trim()).filter(s => s.length > 0)
    }

    return config
  }

  private parseHeadersFromEnv(): Record<string, string> {
    const headersJson = process.env.OPENAPI_MCP_HEADERS
    if (headersJson) {
      try {
        const headers = JSON.parse(headersJson)
        if (typeof headers !== 'object' || headers === null) {
          console.warn('OPENAPI_MCP_HEADERS environment variable must be a JSON object, got:', typeof headers)
        } else if (Object.keys(headers).length > 0) {
          return headers
        }
      } catch (error) {
        console.warn('Failed to parse OPENAPI_MCP_HEADERS environment variable:', error)
      }
    }

    const notionToken = process.env.NOTION_TOKEN
    if (notionToken) {
      return {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2025-09-03'
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
   * Convert an operationId like "createDatabase" to a human-readable title like "Create Database"
   */
  private operationIdToTitle(operationId: string): string {
    // Split on camelCase boundaries and capitalize each word
    return operationId
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  async connect(transport: Transport) {
    // The SDK will handle stdio communication
    await this.server.connect(transport)
  }

  getServer() {
    return this.server
  }
}
