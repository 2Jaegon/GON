const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9_\-]{20,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /github_pat_[a-zA-Z0-9_]{20,}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi,
  /password\s*[:=]\s*["']?[^"'\s\n]{6,}["']?/gi
];

export function redactSecrets(input: string): string {
  if (!input || typeof input !== "string") {
    return input;
  }
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith("bearer ")) {
        return "Bearer [REDACTED]";
      }
      if (/password/i.test(match)) {
        return "password=[REDACTED]";
      }
      return "[REDACTED]";
    });
  }
  return result;
}

export function redactObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactSecrets(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map((item) => redactObject(item)) as unknown as T;
  if (typeof obj === "object") {
    const copy: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/password|secret|token|apiKey|api_key/i.test(k) && typeof v === "string") {
        copy[k] = "[REDACTED]";
      } else {
        copy[k] = redactObject(v);
      }
    }
    return copy as T;
  }
  return obj;
}

