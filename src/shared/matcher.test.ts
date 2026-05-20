import { describe, it, expect } from 'vitest';
import { parseAutoModRule } from './parser';
import { matchPostsAgainstRule } from './matcher';

describe('matcher', () => {
  it('matches posts by title contains', () => {
    const yaml = `title (contains): spam`;
    const rule = parseAutoModRule(yaml);
    expect(rule.valid).toBe(true);
    const posts = [
      { id: '1', title: 'this is spam', body: '', author: 'a', url: '', permalink: '' },
      { id: '2', title: 'hello world', body: '', author: 'b', url: '', permalink: '' },
    ];
    const results = matchPostsAgainstRule(posts as any, rule);
    expect(results.filter(r => r.matched).length).toBe(1);
  });
});
