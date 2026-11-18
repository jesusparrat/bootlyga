export function isSafeEnginePath(path: string): boolean {
  if (!path.startsWith("/ace/") && !path.startsWith("/content/")) return false;
  if (path.includes("\\") || path.includes("..") || path.includes("\0")) return false;
  if (path.startsWith("//")) return false;
  return true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
