import { describe, it, expect } from 'vitest';
import { runDoctor } from '../../cli/src/doctor.js';

describe('runDoctor', () => {
  it('reports installed CLIs and UNKNOWN for missing CLIs', async () => {
    const mockRunner = async (cmd: string) => {
      if (cmd === 'claude') return '2.1.300';
      return null;
    };

    const res = await runDoctor({ runner: mockRunner });
    expect(res.clis.claude.installed).toBe(true);
    expect(res.clis.claude.version).toBe('2.1.300');
    expect(res.clis.codex.installed).toBe(false);
    expect(res.clis.gemini.installed).toBe(false);
  });
});

