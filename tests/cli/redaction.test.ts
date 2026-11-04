import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../cli/src/security/redaction.js';

describe('redactSecrets', () => {
  it('masks OpenAI api keys', () => {
    const text = 'my key is sk-1234567890abcdef and more';
    expect(redactSecrets(text)).toBe('my key is [REDACTED_API_KEY] and more');
  });

  it('masks AWS access keys and Bearer tokens', () => {
    const text = 'AWS: AKIAIOSFODNN7EXAMPLE, auth: Bearer mySecretToken123==';
    const out = redactSecrets(text);
    expect(out).toContain('[REDACTED_AWS_KEY]');
    expect(out).toContain('Bearer [REDACTED_TOKEN]');
  });
});

