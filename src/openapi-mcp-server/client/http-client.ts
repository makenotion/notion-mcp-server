import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types'
import OpenAPIClientAxios from 'openapi-client-axios'
import type { AxiosInstance } from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import { Headers } from './polyfill-headers'
import { isFileUploadParameter } from '../openapi/file-upload'

export type HttpClientConfig = {
  baseUrl: string
  headers?: Record<string, string>
}

export type HttpClientResponse<T = any> = {
  data: T
  status: number
  headers: Headers
}

export class HttpClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: any,
    public headers?: Headers,
  ) {
    super(`${status} ${message}`)
    this.name = 'HttpClientError'
  }
}

export class HttpClient {
  private api: Promise<AxiosInstance>
  private client: OpenAPIClientAxios
  private openApiSpec: OpenAPIV3.Document | OpenAPIV3_1.Document

  constructor(config: HttpClientConfig, openApiSpec: OpenAPIV3.Document | OpenAPIV3_1.Document) {
    this.openApiSpec = openApiSpec
    // @ts-expect-error
    this.client = new (OpenAPIClientAxios.default ?? OpenAPIClientAxios)({
      definition: openApiSpec,
      axiosConfigDefaults: {
        baseURL: config.baseUrl,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'notion-mcp-server',
          ...config.headers,
        },
      },
    })
    this.api = this.client.init()
  }

  /**
   * Parse stringified JSON parameters back to objects.
   * Some MCP clients serialize objects to strings, but the API expects objects.
   * This function detects and parses such parameters based on the OpenAPI schema.
   */
  private parseStringifiedParams(
    params: Record<string, any>,
    operation: OpenAPIV3.OperationObject,
  ): Record<string, any> {
    const result: Record<string, any> = { ...params }
    
    // Get the request body schema to check expected types
    const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined
    const jsonContent = requestBody?.content?.['application/json']
    const schema = jsonContent?.schema as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined
    
    if (!schema) return result

    // Resolve the schema if it's a reference
    const resolvedSchema = this.resolveSchema(schema)
    if (!resolvedSchema || resolvedSchema.type !== 'object' || !resolvedSchema.properties) {
      return result
    }

    // Check each parameter
    for (const [key, value] of Object.entries(result)) {
      if (typeof value !== 'string') continue
      
      const propSchema = resolvedSchema.properties[key] as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined
      if (!propSchema) continue
      
      const resolvedPropSchema = this.resolveSchema(propSchema)
      if (!resolvedPropSchema) continue
      
      // If the schema expects an object or array but we got a string, try to parse it
      if (resolvedPropSchema.type === 'object' || resolvedPropSchema.type === 'array') {
        try {
          const parsed = JSON.parse(value)
          if (typeof parsed === 'object' && parsed !== null) {
            result[key] = parsed
          }
        } catch {
          // Not valid JSON, keep as string
        }
      }
    }

    return result
  }

  /**
   * Resolve a schema reference to its actual schema object.
   */
  private resolveSchema(
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  ): OpenAPIV3.SchemaObject | null {
    if (!('$ref' in schema)) {
      return schema
    }

    const ref = schema.$ref
    if (!ref.startsWith('#/')) {
      return null
    }

    const parts = ref.replace(/^#\//, '').split('/')
    let current: any = this.openApiSpec
    for (const part of parts) {
      current = current?.[part]
      if (!current) return null
    }

    // Handle nested references
    if ('$ref' in current) {
      return this.resolveSchema(current)
    }

    return current as OpenAPIV3.SchemaObject
  }

  private async prepareFileUpload(operation: OpenAPIV3.OperationObject, params: Record<string, any>): Promise<FormData | null> {
    const fileParams = isFileUploadParameter(operation)
    if (fileParams.length === 0) return null

    const formData = new FormData()

    // Handle file uploads
    for (const param of fileParams) {
      const filePath = params[param]
      if (!filePath) {
        throw new Error(`File path must be provided for parameter: ${param}`)
      }
      switch (typeof filePath) {
        case 'string':
          addFile(param, filePath)
          break
        case 'object':
          if(Array.isArray(filePath)) {
            let fileCount = 0
            for(const file of filePath) {
              addFile(param, file)
              fileCount++
            }
            break
          }
          //deliberate fallthrough
        default:
          throw new Error(`Unsupported file type: ${typeof filePath}`)
      }
      function addFile(name: string, filePath: string) {
          try {
            const fileStream = fs.createReadStream(filePath)
            formData.append(name, fileStream)
        } catch (error) {
          throw new Error(`Failed to read file at ${filePath}: ${error}`)
        }
      }
    }

    // Add non-file parameters to form data
    for (const [key, value] of Object.entries(params)) {
      if (!fileParams.includes(key)) {
        formData.append(key, value)
      }
    }

    return formData
  }

  /**
   * Execute an OpenAPI operation
   */
  async executeOperation<T = any>(
    operation: OpenAPIV3.OperationObject & { method: string; path: string },
    params: Record<string, any> = {},
  ): Promise<HttpClientResponse<T>> {
    const api = await this.api
    const operationId = operation.operationId
    if (!operationId) {
      throw new Error('Operation ID is required')
    }

    // Parse stringified JSON parameters back to objects
    const parsedParams = this.parseStringifiedParams(params, operation)

    // Handle file uploads if present
    const formData = await this.prepareFileUpload(operation, parsedParams)

    // Separate parameters based on their location
    const urlParameters: Record<string, any> = {}
    const bodyParams: Record<string, any> = formData || { ...parsedParams }

    // Extract path and query parameters based on operation definition
    if (operation.parameters) {
      for (const param of operation.parameters) {
        if ('name' in param && param.name && param.in) {
          if (param.in === 'path' || param.in === 'query') {
            if (parsedParams[param.name] !== undefined) {
              urlParameters[param.name] = parsedParams[param.name]
              if (!formData) {
                delete bodyParams[param.name]
              }
            }
          }
        }
      }
    }

    // Add all parameters as url parameters if there is no requestBody defined
    if (!operation.requestBody && !formData) {
      for (const key in bodyParams) {
        if (bodyParams[key] !== undefined) {
          urlParameters[key] = bodyParams[key]
          delete bodyParams[key]
        }
      }
    }

    const operationFn = (api as any)[operationId]
    if (!operationFn) {
      throw new Error(`Operation ${operationId} not found`)
    }

    try {
      // If we have form data, we need to set the correct headers
      const hasBody = Object.keys(bodyParams).length > 0
      const headers = formData
        ? formData.getHeaders()
        : { ...(hasBody ? { 'Content-Type': 'application/json' } : { 'Content-Type': null }) }
      const requestConfig = {
        headers: {
          ...headers,
        },
      }

      // first argument is url parameters, second is body parameters
      const response = await operationFn(urlParameters, hasBody ? bodyParams : undefined, requestConfig)

      // Convert axios headers to Headers object
      const responseHeaders = new Headers()
      Object.entries(response.headers).forEach(([key, value]) => {
        if (value) responseHeaders.append(key, value.toString())
      })

      return {
        data: response.data,
        status: response.status,
        headers: responseHeaders,
      }
    } catch (error: any) {
      if (error.response) {
        // Only log errors in non-test environments to keep test output clean
        if (process.env.NODE_ENV !== 'test') {
          console.error('Error in http client', {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
          })
        }
        const headers = new Headers()
        Object.entries(error.response.headers).forEach(([key, value]) => {
          if (value) headers.append(key, value.toString())
        })

        throw new HttpClientError(error.response.statusText || 'Request failed', error.response.status, error.response.data, headers)
      }
      throw error
    }
  }
}
