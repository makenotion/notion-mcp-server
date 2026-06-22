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

/**
 * Recursively deserialize stringified JSON values in parameters.
 * This handles the case where MCP clients (like Cursor, Claude Code, and some
 * SDKs) double-serialize nested object/array parameters, sending them as JSON
 * strings instead of structured values.
 *
 * The whole argument tree is walked uniformly: every object property and every
 * array element is visited, JSON-looking strings are decoded, and the decoded
 * result is walked again. This normalizes deeply nested cases — including a
 * stringified object that sits inside an array element object (e.g.
 * `{ children: [{ paragraph: '{"rich_text":[...]}' }] }`) and values that were
 * JSON-encoded more than once (e.g. `JSON.stringify(JSON.stringify(parent))`) —
 * before the request is forwarded to the Notion API.
 *
 * @see https://github.com/makenotion/notion-mcp-server/issues/176
 */
function deserializeParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    result[key] = deserializeValue(value)
  }
  return result
}

/**
 * Normalize a single value: decode a JSON-encoded string into the structured
 * value it represents (recursing into the result), walk into every array
 * element, and walk into every nested object property. Non-JSON strings and
 * scalars are returned unchanged, so values the schema legitimately wants as
 * strings (and numbers/booleans encoded as strings) are left intact.
 */
function deserializeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return unwrapJsonString(value)
  }

  if (Array.isArray(value)) {
    return value.map(deserializeValue)
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      result[key] = deserializeValue(nested)
    }
    return result
  }

  return value
}

// Bound how many JSON-decode passes we attempt on a single string. One pass
// handles the common single-encoding; extra passes absorb double/triple
// serialization without unbounded work on adversarial input.
const MAX_UNWRAP_DEPTH = 3

/**
 * Resolve a (possibly multiply-)JSON-encoded string to the object or array it
 * represents. Only strings that ultimately decode to an object or array are
 * transformed (and then recursively normalized); a string that decodes to a
 * scalar (number/boolean/null) or to another plain string is returned
 * unchanged, so genuine string values are never corrupted.
 */
function unwrapJsonString(value: string): unknown {
  let current = value
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    const trimmed = current.trim()
    // Only attempt a parse when the string could encode an object/array
    // (`{...}`/`[...]`) or wrap one in a JSON string literal (`"..."`). This
    // skips the common case of ordinary text without touching JSON.parse.
    const couldBeEncoded =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    if (!couldBeEncoded) {
      break
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      break
    }

    if (typeof parsed === 'object' && parsed !== null) {
      return deserializeValue(parsed)
    }
    if (typeof parsed === 'string') {
      // Peeled one layer of JSON-string encoding; loop to see whether it wraps
      // a structured value (double-encoding).
      current = parsed
      continue
    }
    // Decoded to a scalar — not a structured value; leave the original intact.
    break
  }
  return value
}

// import this class, extend and return server
export class MCPProxy {
  private server: Server
  private httpClient: HttpClient
  private tools: Record<string, NewToolDefinition>
  private openApiLookup: Record<string, OpenAPIV3.OperationObject & { method: string; path: string }>

  /**
   * @param headers Notion API headers to authenticate with. When omitted, the
   *   headers are resolved from the environment (`OPENAPI_MCP_HEADERS` /
   *   `NOTION_TOKEN`). The HTTP transport passes per-connection headers here so a
   *   single deployment can serve multiple Notion integrations.
   */
  constructor(name: string, openApiSpec: OpenAPIV3.Document, headers?: Record<string, string>) {
    this.server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {} } })
    const baseUrl = openApiSpec.servers?.[0].url
    if (!baseUrl) {
      throw new Error('No base URL found in OpenAPI spec')
    }
    this.httpClient = new HttpClient(
      {
        baseUrl,
        headers: headers ?? this.parseHeadersFromEnv(),
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

      // Deserialize any stringified JSON parameters (fixes double-serialization bug)
      // See: https://github.com/makenotion/notion-mcp-server/issues/176
      const deserializedParams = params ? deserializeParams(params as Record<string, unknown>) : {}

      try {
        // Execute the operation
        const response = await this.httpClient.executeOperation(operation, deserializedParams)

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
        console.error('Error in tool call', error instanceof Error ? error.message : 'Unknown error')
        if (error instanceof HttpClientError) {
          console.error('HttpClientError encountered, returning structured error', { status: error.status })
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
      // Notion-Version is intentionally omitted: it is sourced per-operation from
      // the OpenAPI spec by HttpClient, so endpoints can pin the version they need.
      return {
        'Authorization': `Bearer ${notionToken}`,
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
