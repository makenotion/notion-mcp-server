# Pull Request

## Title
```
fix: add type: object hint for oneOf/anyOf/allOf with object schemas
```

## Description

## Problem

MCP clients were encountering schema validation errors when passing complex object parameters (like `parent`, `data`, `new_parent`) to tools with `oneOf`, `anyOf`, or `allOf` schemas. The error message was:

```
Expected object, received string
```

This occurred because the JSON Schema generated from OpenAPI didn't explicitly include `type: "object"` for composite schemas where all options were objects, causing some MCP clients to incorrectly serialize the parameters.

Related issue: #209

## Solution

Enhanced the `convertOpenApiSchemaToJsonSchema` method in `parser.ts` to automatically add `type: "object"` when all options in a `oneOf`, `anyOf`, or `allOf` schema are object types.

The fix:
1. **Detects object schemas** - Checks if all options have `type: "object"`, `properties`, or are `$ref` references to object-like schemas (Request, Response, Object)
2. **Adds type hint** - Injects `type: "object"` into the composite schema to guide MCP clients
3. **Preserves compatibility** - Fully backward compatible, only adds hints where all options are already objects

## Changes

**File: `src/openapi-mcp-server/openapi/parser.ts`**

Added logic to three schema conversion blocks:

- **oneOf** (lines 159-179): Checks all options and adds `type: "object"` if all are objects
- **anyOf** (lines 180-200): Same logic for anyOf schemas
- **allOf** (lines 201-221): Same logic for allOf schemas

Each block uses a helper check that:
- Identifies explicit `type: "object"` or `properties` 
- Resolves `$ref` paths and checks if they reference Request/Response/Object schemas

## Testing

Manually tested by creating pages in a Notion database using the `post-page` tool with complex `parent` parameter:

```typescript
{
  parent: { database_id: "..." },  // Previously rejected, now accepted
  properties: { ... }
}
```

## Impact

- ✅ Fixes schema validation errors for complex parameters
- ✅ Improves compatibility with MCP clients that rely on `type` hints
- ✅ No breaking changes - existing functionality preserved
- ✅ Enables smoother integration with tools like Claude Desktop, Cursor, etc.

---

## Labels
- `bug`
- `enhancement`

## Reviewers
- @makenotion team
