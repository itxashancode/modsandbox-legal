export type RuleCondition = {
  field: 'title' | 'body' | 'url' | 'author' | 'domain';
  operator: 'contains' | 'regex' | 'starts-with' | 'ends-with' | 'equals';
  value: string;
};

export type ParsedRule = {
  raw: string;
  conditions: RuleCondition[];
  action: 'remove' | 'report' | 'approve' | 'filter' | null;
  actionReason: string;
  valid: boolean;
  parseError?: string;
};

export type MatchResult = {
  postId: string;
  title: string;
  body: string;
  author: string;
  url: string;
  permalink: string;
  matched: boolean;
  matchedConditions: RuleCondition[];
  highlights: HighlightSegment[];
};

export type HighlightSegment = {
  text: string;
  highlighted: boolean;
};

export type TestRunResult = {
  totalTested: number;
  totalMatched: number;
  matches: MatchResult[];
  runAt: string;
};