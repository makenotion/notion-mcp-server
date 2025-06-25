# Notion MCP Server Middleware

This directory contains middleware components that process requests and responses to make the server more flexible and accommodating to different client implementations.

## Request Normalizer

The `request-normalizer.ts` module contains functions that normalize incoming API requests to ensure they match the expected structure of the Notion API, even if they have minor structural differences.

### Key Features

- **Rich Text Normalization**: Fixes a common issue where `annotations` are placed inside the `text` object instead of being a sibling. This is a frequent issue with LLM-generated requests.

- **Structure Preservation**: The normalizer carefully preserves all data while only adjusting the structure to match what the validation expects.

### Usage

The request normalizer is automatically applied to all incoming requests in the HTTP client, so it works without any additional configuration.

### Example Transformation

Before normalization:
```json
{
  "rich_text": [
    {
      "type": "text",
      "text": {
        "content": "Save recording...",
        "annotations": {
          "color": "gray"
        }
      }
    }
  ]
}
```

After normalization:
```json
{
  "rich_text": [
    {
      "type": "text",
      "text": {
        "content": "Save recording..."
      },
      "annotations": {
        "color": "gray"
      }
    }
  ]
}
```

### Testing

The normalizer includes comprehensive tests to ensure it handles a variety of cases correctly. Run the tests with:

```bash
npm test
```

## Extending

To add more normalization rules:

1. Add new normalization functions to `request-normalizer.ts`
2. Call them from the `normalizeRequestPayload` function
3. Add tests to validate the new functionality