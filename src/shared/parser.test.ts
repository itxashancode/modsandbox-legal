import { describe, it, expect } from 'vitest';
import { parseAutoModRule } from './parser';

describe('parseAutoModRule', () => {
  it('parses simple contains and action', () => {
    const yaml = `type: submission\ntitle (contains): [spam, free money]\naction: remove`;
    const res = parseAutoModRule(yaml);
    expect(res.valid).toBe(true);
    expect(res.conditions.length).toBe(2);
    expect(res.action).toBe('remove');
  });

  it('returns error for empty rule', () => {
    const res = parseAutoModRule('   \n');
    expect(res.valid).toBe(false);
    expect(res.parseError).toBeDefined();
  });
});
