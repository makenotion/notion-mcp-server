export interface ToolFilterConfig {
  include?: string[];
  exclude?: string[];
  resourceTypes?: string[];
}

export function matchesPattern(value: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(value);
}

export function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchesPattern(value, pattern));
}

export function extractResourceType(path: string): string | null {
  const match = path.match(/^\/v1\/([^\/]+)/);
  if (!match) return null;

  const segment = match[1];

  if (segment === 'search') return 'search';
  if (segment === 'users') return 'users';
  if (segment === 'pages') return 'pages';
  if (segment === 'blocks') return 'blocks';
  if (segment === 'databases') return 'databases';
  if (segment === 'comments') return 'comments';

  return null;
}

export function shouldIncludeOperation(
  operationId: string,
  path: string,
  config?: ToolFilterConfig
): boolean {
  if (!config) return true;

  const resourceType = extractResourceType(path);

  if (config.resourceTypes && config.resourceTypes.length > 0) {
    if (!resourceType || !config.resourceTypes.includes(resourceType)) {
      return false;
    }
  }

  if (config.include && config.include.length > 0) {
    if (!matchesAnyPattern(operationId, config.include)) {
      return false;
    }
  }

  if (config.exclude && config.exclude.length > 0) {
    if (matchesAnyPattern(operationId, config.exclude)) {
      return false;
    }
  }

  return true;
}
