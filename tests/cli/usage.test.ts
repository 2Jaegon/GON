import { describe, it, expect } from 'vitest';
import { parseJsonlUsage } from '../../cli/src/observability/usage-claude.js';

describe('parseJsonlUsage', () => {
  it('deduplicates usage by message ID (last-wins)', () => {
    const lines = [
      JSON.stringify({
        message: {
          id: 'msg_1',
          usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
        },
      }),
      JSON.stringify({
        message: {
          id: 'msg_1', // repeated with higher output
          usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 25 },
        },
      }),
      JSON.stringify({
        message: {
          id: 'msg_2',
          usage: { input_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 40, output_tokens: 30 },
        },
      }),
    ];

    const { byMsgId } = parseJsonlUsage(lines);
    expect(byMsgId.size).toBe(2);
    expect(byMsgId.get('msg_1')?.output).toBe(25);
    expect(byMsgId.get('msg_2')?.input).toBe(50);
  });
});

