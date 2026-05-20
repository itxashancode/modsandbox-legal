import type { ParsedRule, RuleCondition } from './types';

export function parseAutoModRule(yaml: string): ParsedRule {
  const base: ParsedRule = {
    raw: yaml,
    conditions: [],
    action: null,
    actionReason: '',
    valid: false,
  };

  if (!yaml.trim()) {
    return { ...base, parseError: 'Rule is empty' };
  }

  try {
    const conditions: RuleCondition[] = [];
    const lines = yaml.split('\n');
    let action: ParsedRule['action'] = null;
    let actionReason = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // action
      if (trimmed.startsWith('action:')) {
        const val = trimmed.replace('action:', '').trim().toLowerCase();
        if (val === 'remove' || val === 'report' || val === 'approve' || val === 'filter') {
          action = val;
        }
        continue;
      }

      // action reason
      if (trimmed.startsWith('action_reason:')) {
        actionReason = trimmed.replace('action_reason:', '').trim().replace(/['"]/g, '');
        continue;
      }

      // title contains / title (regex)
      const titleContains = trimmed.match(/^title\s*\(contains\)\s*:\s*(.+)$/);
      if (titleContains?.[1]) {
        const values = extractValues(titleContains[1]);
        values.forEach(v => conditions.push({ field: 'title', operator: 'contains', value: v }));
        continue;
      }

      const titleRegex = trimmed.match(/^title\s*\(regex\)\s*:\s*(.+)$/);
      if (titleRegex?.[1]) {
        const values = extractValues(titleRegex[1]);
        values.forEach(v => conditions.push({ field: 'title', operator: 'regex', value: v }));
        continue;
      }

      const titlePlain = trimmed.match(/^title\s*:\s*(.+)$/);
      if (titlePlain?.[1]) {
        const values = extractValues(titlePlain[1]);
        values.forEach(v => conditions.push({ field: 'title', operator: 'contains', value: v }));
        continue;
      }

      // body contains / body regex
      const bodyContains = trimmed.match(/^body\s*\(contains\)\s*:\s*(.+)$/);
      if (bodyContains?.[1]) {
        const values = extractValues(bodyContains[1]);
        values.forEach(v => conditions.push({ field: 'body', operator: 'contains', value: v }));
        continue;
      }

      const bodyRegex = trimmed.match(/^body\s*\(regex\)\s*:\s*(.+)$/);
      if (bodyRegex?.[1]) {
        const values = extractValues(bodyRegex[1]);
        values.forEach(v => conditions.push({ field: 'body', operator: 'regex', value: v }));
        continue;
      }

      const bodyPlain = trimmed.match(/^body\s*:\s*(.+)$/);
      if (bodyPlain?.[1]) {
        const values = extractValues(bodyPlain[1]);
        values.forEach(v => conditions.push({ field: 'body', operator: 'contains', value: v }));
        continue;
      }

      // author
      const author = trimmed.match(/^author\s*:\s*(.+)$/);
      if (author?.[1]) {
        const values = extractValues(author[1]);
        values.forEach(v => conditions.push({ field: 'author', operator: 'equals', value: v }));
        continue;
      }

      // domain
      const domain = trimmed.match(/^domain\s*:\s*(.+)$/);
      if (domain?.[1]) {
        const values = extractValues(domain[1]);
        values.forEach(v => conditions.push({ field: 'domain', operator: 'contains', value: v }));
        continue;
      }
    }

    if (conditions.length === 0) {
      return { ...base, parseError: 'No supported conditions found. Supported: title, body, author, domain (with contains/regex operators)' };
    }

    return { raw: yaml, conditions, action, actionReason, valid: true };
  } catch (e) {
    return { ...base, parseError: `Parse error: ${String(e)}` };
  }
}

function extractValues(str: string): string[] {
  const trimmed = str.trim();
  // handle YAML list like: [spam, bad word, scam]
  if (trimmed.startsWith('[')) {
    return trimmed
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(v => v.trim().replace(/['"]/g, ''))
      .filter(Boolean);
  }
  // handle quoted string
  return [trimmed.replace(/['"]/g, '').trim()];
}