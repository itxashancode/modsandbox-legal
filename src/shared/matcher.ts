import type { MatchResult, ParsedRule, RuleCondition, HighlightSegment } from './types';

type PostLike = {
  id: string;
  title: string;
  body: string;
  author: string;
  url: string;
  permalink: string;
};

export function matchPostsAgainstRule(
  posts: PostLike[],
  rule: ParsedRule
): MatchResult[] {
  return posts.map(post => matchSinglePost(post, rule));
}

function matchSinglePost(post: PostLike, rule: ParsedRule): MatchResult {
  const matchedConditions: RuleCondition[] = [];

  for (const condition of rule.conditions) {
    const fieldValue = getField(post, condition.field);
    if (testCondition(fieldValue, condition)) {
      matchedConditions.push(condition);
    }
  }

  const matched = matchedConditions.length > 0;
  const highlights = matched
    ? buildHighlights(post.title, matchedConditions.filter(c => c.field === 'title'))
    : [{ text: post.title, highlighted: false }];

  return {
    postId: post.id,
    title: post.title,
    body: post.body ?? '',
    author: post.author,
    url: post.url,
    permalink: post.permalink,
    matched,
    matchedConditions,
    highlights,
  };
}

function getField(post: PostLike, field: RuleCondition['field']): string {
  switch (field) {
    case 'title': return post.title ?? '';
    case 'body': return post.body ?? '';
    case 'author': return post.author ?? '';
    case 'url': return post.url ?? '';
    case 'domain':
      try {
        return post.url ? new URL(post.url).hostname : '';
      } catch (_) {
        return '';
      }
    default: return '';
  }
}

function testCondition(value: string, condition: RuleCondition): boolean {
  const v = value.toLowerCase();
  const c = condition.value.toLowerCase();
  switch (condition.operator) {
    case 'contains': return v.includes(c);
    case 'equals': return v === c;
    case 'starts-with': return v.startsWith(c);
    case 'ends-with': return v.endsWith(c);
    case 'regex': {
      try {
        return new RegExp(condition.value, 'i').test(value);
      } catch { return false; }
    }
    default: return false;
  }
}

export function buildHighlights(text: string, conditions: RuleCondition[]): HighlightSegment[] {
  if (!conditions.length) return [{ text, highlighted: false }];

  // find all match ranges
  const ranges: Array<[number, number]> = [];
  for (const cond of conditions) {
    if (cond.operator === 'regex') {
      try {
        const re = new RegExp(cond.value, 'gi');
        let m;
        while ((m = re.exec(text)) !== null) {
          ranges.push([m.index, m.index + m[0].length]);
        }
      } catch { /* skip bad regex */ }
    } else {
      const lower = text.toLowerCase();
      const val = cond.value.toLowerCase();
      let idx = lower.indexOf(val);
      while (idx !== -1) {
        ranges.push([idx, idx + val.length]);
        idx = lower.indexOf(val, idx + 1);
      }
    }
  }

  if (!ranges.length) return [{ text, highlighted: false }];

  // merge overlapping ranges
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  if (ranges.length > 0) {
    merged.push(ranges[0] as [number, number]);
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1];
      const current = ranges[i] as [number, number];
      if (last && current[0] <= last[1]) {
        last[1] = Math.max(last[1], current[1]);
      } else {
        merged.push(current);
      }
    }
  }

  // build segments
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (cursor < start) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });

  return segments;
}