const SECRET_PATTERNS = [
  { name: 'API Key (sk-)', re: /sk-[A-Za-z0-9_-]{8,}/g, repl: '[REDACTED_API_KEY]' },
  { name: 'GitHub Token (ghp_)', re: /ghp_[A-Za-z0-9_]{16,}/g, repl: '[REDACTED_GH_TOKEN]' },
  { name: 'AWS Access Key (AKIA)', re: /AKIA[0-9A-Z]{12,}/g, repl: '[REDACTED_AWS_KEY]' },
  { name: 'Bearer Token', re: /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, repl: 'Bearer [REDACTED_TOKEN]' },
  { name: 'Password assignment', re: /(password\s*[:=]\s*)['"]?[^'"\s\r\n]{4,}['"]?/gi, repl: '$1"[REDACTED_PASSWORD]"' },
  { name: 'Secret Env Assignment', re: /((?:[A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*)['"]?[^'"\s\r\n]+['"]?/gi, repl: '$1"[REDACTED]"' },
];

export function redactSecrets(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(pat.re, pat.repl);
  }
  return out;
}

