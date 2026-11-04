import { describe, it, expect } from 'vitest';
import { generateStatusLine } from '../../cli/src/statusline.js';

describe('generateStatusLine', () => {
  it('formats statusline from context_window when transcript is absent', () => {
    const input = JSON.stringify({
      cost: { total_duration_ms: 125000, total_cost_usd: 0.15 },
      context_window: { total_input_tokens: 5000, total_output_tokens: 1200 },
    });
    const line = generateStatusLine(input);
    expect(line).toContain('⏱ 2m05s');
    expect(line).toContain('in 5.0k · out 1.2k');
    expect(line).toContain('$0.15 (CC 집계)');
  });

  it('handles empty or malformed JSON gracefully without throwing', () => {
    const line1 = generateStatusLine('');
    expect(line1).toContain('⏱ 0s');

    const line2 = generateStatusLine('{invalid json');
    expect(line2).toContain('⏱ 0s');
  });
});

