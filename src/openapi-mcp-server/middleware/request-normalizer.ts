/**
 * Middleware to normalize Notion API requests before they reach the validation layer
 * This helps make the server more forgiving of different API client implementations,
 * particularly LLMs that might structure requests in slightly different ways.
 */

/**
 * Normalizes the structure of rich_text objects in Notion API requests
 * - Moves annotations from text.annotations to root level annotations
 * - Ensures no additional properties where they're not allowed
 * 
 * @param payload The original request payload
 * @returns The normalized request payload
 */
export function normalizeRichTextObjects(payload: any): any {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  // Handle arrays
  if (Array.isArray(payload)) {
    return payload.map(item => normalizeRichTextObjects(item));
  }

  const result = { ...payload };

  // Process nested properties first (depth-first traversal)
  for (const key in result) {
    if (result[key] && typeof result[key] === 'object') {
      result[key] = normalizeRichTextObjects(result[key]);
    }
  }

  // Special handling for rich_text arrays
  if (result.rich_text && Array.isArray(result.rich_text)) {
    result.rich_text = result.rich_text.map((item: any) => normalizeRichTextItem(item));
  }

  // Handle specific case where there's a block with children
  if (result.children && Array.isArray(result.children)) {
    result.children = result.children.map((child: any) => normalizeRichTextObjects(child));
  }

  return result;
}

/**
 * Normalizes a single rich_text item
 */
function normalizeRichTextItem(item: any): any {
  if (!item || typeof item !== 'object') {
    return item;
  }

  const result = { ...item };

  // Fix common issue: annotations nested inside text object
  if (result.text && typeof result.text === 'object' && result.text.annotations) {
    // Move annotations to the correct location
    result.annotations = result.text.annotations;
    delete result.text.annotations;
  }

  // Recursively normalize any nested objects
  for (const key in result) {
    if (result[key] && typeof result[key] === 'object') {
      result[key] = normalizeRichTextObjects(result[key]);
    }
  }

  return result;
}

/**
 * Main function to normalize a request payload before it's validated
 * against the OpenAPI schema
 */
export function normalizeRequestPayload(payload: any): any {
  if (!payload) return payload;
  
  // Apply all normalization functions
  let normalized = normalizeRichTextObjects(payload);
  
  return normalized;
}