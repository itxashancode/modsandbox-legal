import { TRPCError, initTRPC } from '@trpc/server';
import { transformer } from '../shared/transformer';
import { Context } from './context';
import { context, reddit } from '@devvit/web/server';
import { z } from 'zod';
import { parseAutoModRule } from '../shared/parser';
import { matchPostsAgainstRule } from '../shared/matcher';
import { createModOnlyProcedure } from './middleware';

const getCleanUsername = () => {
  const raw = context.username;
  return raw?.split(',')[0]?.trim();
};

const getCleanSubredditName = () => {
  const raw = context.subredditName;
  return raw?.split(',')[0]?.trim();
};

const t = initTRPC.context<Context>().create({ transformer });

export const router = t.router;
export const publicProcedure = t.procedure;
export const modOnlyProcedure = createModOnlyProcedure(publicProcedure);

export const appRouter = t.router({
  init: t.router({
    get: publicProcedure.query(async () => {
      const username = getCleanUsername();
      return { username, postId: context.postId };
    }),
  }),

  rules: t.router({
    // In-memory fallback store for environments without Redis (playtest)
    _memoryStore: t.procedure.query(() => {
      return true;
    }),

    // Helper: attempt to get redis-like API, otherwise return fallback
    // (We intentionally avoid using Context types since Devvit injects runtime context)
    
    test: modOnlyProcedure
      .input(z.object({
        yaml: z.string()
          .min(1, 'Rule cannot be empty')
          .max(5000, 'Rule too long — max 5000 characters')
          .refine(val => !val.includes('javascript:') && !val.includes('<script'), 'Invalid rule content'),
        limit: z.number().min(10).max(200).optional(),
      }))
      .mutation(async ({ input }: { input: { yaml: string; limit?: number } }) => {
        try {
          const c = context as any;
          const username = getCleanUsername();
          const rateLimitKey = `ratelimit:${username}`;
          let lastRun: string | null = null;
          if (c && c.redis) {
            lastRun = await c.redis.get(rateLimitKey);
          } else {
            const rateLimitStore: Record<string, string> = (globalThis as any).__ruleforge_rate_limit ||= {};
            lastRun = rateLimitStore[rateLimitKey] ?? null;
          }
          if (lastRun) {
            const secondsSinceLastRun = (Date.now() - parseInt(lastRun, 10)) / 1000;
            if (secondsSinceLastRun < 30) {
              throw new TRPCError({
                code: 'TOO_MANY_REQUESTS',
                message: `Please wait ${Math.ceil(30 - secondsSinceLastRun)} seconds before testing again`,
              });
            }
          }
          // parse the rule
          const rule = parseAutoModRule(input.yaml);
          if (!rule.valid) {
            return { success: false, error: rule.parseError, results: null };
          }

          // fetch the recent posts for rule validation
          const subredditName = getCleanSubredditName();
          if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
          const subreddit = { name: subredditName };
          const limit = input.limit ?? 100;
          
          let posts: any[] = [];
          let isMockData = false;

          try {
            const listing = await reddit.getNewPosts({
              subredditName: subreddit.name,
              limit,
            });
            posts = await listing.all();
          } catch (e: any) {
            console.warn('[ModSandbox] Failed to fetch posts via Reddit API, falling back to mock dataset:', e);
            isMockData = true;
            posts = [
              {
                id: 'mock_post_1',
                title: 'Get rich quick! Free money here, click now!',
                selftext: 'Earn $5000 a day working from home. Absolutely legit click here to sign up!',
                authorName: 'spambot42',
                url: 'https://reddit.com/r/ruleforgetest',
                permalink: '/r/ruleforgetest/comments/mock_post_1',
              },
              {
                id: 'mock_post_2',
                title: 'Check out this awesome gameplay video',
                selftext: 'I spent 10 hours editing this highlight reel, let me know what you think!',
                authorName: 'gaming_fanatic',
                url: 'https://reddit.com/r/ruleforgetest',
                permalink: '/r/ruleforgetest/comments/mock_post_2',
              },
              {
                id: 'mock_post_3',
                title: '[Ad] Buy the best sneakers now with 50% discount!',
                selftext: 'Limited stock available, click the link to claim your offer.',
                authorName: 'shoestore_promo',
                url: 'https://reddit.com/r/ruleforgetest',
                permalink: '/r/ruleforgetest/comments/mock_post_3',
              },
              {
                id: 'mock_post_4',
                title: 'Daily discussion thread - May 20',
                selftext: 'Use this thread to talk about anything related to the sub!',
                authorName: 'AutoModerator',
                url: 'https://reddit.com/r/ruleforgetest',
                permalink: '/r/ruleforgetest/comments/mock_post_4',
              }
            ];
          }

          // shape posts for matcher
          const shaped = posts.map(p => ({
            id: (p as any).id,
            title: (p as any).title ?? '',
            body: (p as any).selftext ?? (p as any).body ?? '',
            author: (p as any).authorName ?? (p as any).author ?? '',
            url: (p as any).url ?? '',
            permalink: (p as any).permalink ?? '',
          }));

          const matches = matchPostsAgainstRule(shaped, rule);
          const matchedPosts = matches.filter(m => m.matched);
          const matchedPostIds = new Set(matchedPosts.map(m => m.postId));
          const testedPostIds = new Set(shaped.map(p => p.id));

          const logActionedPostIds = new Set<string>();
          const modLogSummary = { fetched: 0, used: 0 };

          if (isMockData) {
            logActionedPostIds.add('mock_post_1');
            logActionedPostIds.add('mock_post_3');
            modLogSummary.fetched = 2;
            modLogSummary.used = 2;
          } else {
            try {
              const modLogListing = await reddit.getModerationLog({
                subredditName: subreddit.name,
                limit: 200,
                pageSize: 100,
              });
              const modActions = await modLogListing.all();
              modLogSummary.fetched = modActions.length;
              for (const action of modActions) {
                const targetId = action.target?.id;
                if (!targetId) continue;
                if (!testedPostIds.has(targetId)) continue;
                logActionedPostIds.add(targetId);
              }
              modLogSummary.used = logActionedPostIds.size;
            } catch (e) {
              console.warn('Could not fetch moderation log for scoring', e);
            }
          }

          const truePositives = matchedPosts.filter(m => logActionedPostIds.has(m.postId));
          const falseNegatives = Array.from(logActionedPostIds).filter(id => !matchedPostIds.has(id));
          const falsePositives = matchedPosts.filter(m => !logActionedPostIds.has(m.postId));
          const precision = matchedPosts.length > 0 ? Math.round((truePositives.length / matchedPosts.length) * 100) : 0;
          const recall = matchedPosts.length + falseNegatives.length > 0 ? Math.round((truePositives.length / (truePositives.length + falseNegatives.length)) * 100) : 0;

          const run = {
            yaml: input.yaml,
            results: {
              totalTested: shaped.length,
              totalMatched: matchedPosts.length,
              matches: matchedPosts,
              truePositiveCount: truePositives.length,
              falseNegativeCount: falseNegatives.length,
              falsePositiveCount: falsePositives.length,
              precision,
              recall,
              modLogSummary,
              runAt: new Date().toISOString(),
              isMockData,
              moderator: username || 'anonymous',
            },
          };

          // Set rate-limit marker after a successful run
          try {
            const c = context as any;
            const username = getCleanUsername();
            const rateLimitKey = `ratelimit:${username}`;
            if (c && c.redis) {
              await c.redis.set(rateLimitKey, Date.now().toString(), { expiration: 60 });
            } else {
              const rateLimitStore: Record<string, string> = (globalThis as any).__ruleforge_rate_limit ||= {};
              rateLimitStore[rateLimitKey] = Date.now().toString();
            }
          } catch (e) {
            console.warn('Could not persist rate limit marker', e);
          }

          // attempt to persist run; fall back to in-memory store when Redis unavailable
          try {
            const c = context as any;
            const subredditName = getCleanSubredditName();
            if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
            const subreddit = { name: subredditName };
            const key = `rule_runs:${subreddit.name}`;
            if (c && c.redis) {
              await c.redis.lPush(key, JSON.stringify(run));
              await c.redis.lTrim(key, 0, 49);
            } else {
              // use simple in-memory fallback
              const memKey = `rule_runs:${subreddit.name}`;
              const store: Record<string, string[]> = (globalThis as any).__ruleforge_mem_store ||= {};
              store[memKey] ||= [];
              store[memKey].unshift(JSON.stringify(run));
              store[memKey] = store[memKey].slice(0, 50);
            }
          } catch (e) {
            console.warn('Could not persist run to redis', e);
          }

          return {
            success: true,
            error: null,
            results: run.results,
          };
        } catch (err) {
          console.error('Unexpected error in rules.test:', err);
          return { success: false, error: String(err), results: null };
        }
      }),

    history: modOnlyProcedure.query(async () => {
      try {
        const c = context as any;
        const subredditName = getCleanSubredditName();
        if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
        const subreddit = { name: subredditName };
        const key = `rule_runs:${subreddit.name}`;
        let items: string[] = [];
        if (c && c.redis) {
          items = await c.redis.lRange(key, 0, 49);
        } else {
          const store: Record<string, string[]> = (globalThis as any).__ruleforge_mem_store ||= {};
          items = store[key] ?? [];
        }
        // parse JSON entries robustly
        const out: any[] = [];
        for (const it of items) {
          try {
            out.push(JSON.parse(it));
          } catch {
            // skip non-JSON entries
          }
        }
        return out;
      } catch (e) {
        return [];
      }
    }),

    save: modOnlyProcedure
      .input(z.object({
        yaml: z.string()
          .min(1, 'Rule cannot be empty')
          .max(5000, 'Rule too long — max 5000 characters')
          .refine(val => !val.includes('javascript:') && !val.includes('<script'), 'Invalid rule content'),
        name: z.string(),
      }))
      .mutation(async ({ input }: { input: { yaml: string; name: string } }) => {
        try {
          const c = context as any;
          const username = getCleanUsername();
          const subredditName = getCleanSubredditName();
          if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
          const subreddit = { name: subredditName };
          const key = `saved_rule:${subreddit.name}:${input.name}`;
          const payload = JSON.stringify({
            yaml: input.yaml,
            savedAt: new Date().toISOString(),
            savedBy: username || 'anonymous',
          });
          if (c && c.redis) {
            await c.redis.set(key, payload);
          } else {
            const store: Record<string, string> = (globalThis as any).__ruleforge_saved ||= {};
            store[`${subreddit.name}:${input.name}`] = payload;
          }
          return { success: true };
        } catch (e) {
          console.warn('Could not save rule to redis', e);
          return { success: false, error: String(e) };
        }
      }),

      getSaved: modOnlyProcedure.query(async () => {
        try {
          const c = context as any;
          const subredditName = getCleanSubredditName();
          if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
          const subreddit = { name: subredditName };
          const prefix = `saved_rule:${subreddit.name}:`;
          const rules: Record<string, { yaml: string; savedBy: string; savedAt: string }> = {};
          if (c && c.redis) {
            const keys = await c.redis.keys(`${prefix}*`);
            for (const key of keys) {
              const val = await c.redis.get(key);
              if (!val) continue;
              const ruleName = key.replace(prefix, '');
              try {
                const parsed = JSON.parse(val);
                if (parsed && typeof parsed === 'object' && typeof parsed.yaml === 'string') {
                  rules[ruleName] = {
                    yaml: parsed.yaml,
                    savedBy: parsed.savedBy ?? 'anonymous',
                    savedAt: parsed.savedAt ?? new Date().toISOString(),
                  };
                  continue;
                }
                throw new Error('Invalid saved rule payload');
              } catch {
                const rawYaml = String(val);
                const migrated = JSON.stringify({ yaml: rawYaml, savedAt: new Date().toISOString(), savedBy: 'anonymous' });
                await c.redis.set(key, migrated);
                rules[ruleName] = { yaml: rawYaml, savedBy: 'anonymous', savedAt: new Date().toISOString() };
              }
            }
          } else {
            const store: Record<string, string> = (globalThis as any).__ruleforge_saved ||= {};
            for (const [prefixedName, val] of Object.entries(store)) {
              if (!prefixedName.startsWith(`${subreddit.name}:`)) continue;
              const ruleName = prefixedName.replace(`${subreddit.name}:`, '');
              try {
                const parsed = JSON.parse(val);
                if (parsed && typeof parsed === 'object' && typeof parsed.yaml === 'string') {
                  rules[ruleName] = {
                    yaml: parsed.yaml,
                    savedBy: parsed.savedBy ?? 'anonymous',
                    savedAt: parsed.savedAt ?? new Date().toISOString(),
                  };
                  continue;
                }
                throw new Error('Invalid saved rule payload');
              } catch {
                const rawYaml = String(val);
                const migrated = JSON.stringify({ yaml: rawYaml, savedAt: new Date().toISOString(), savedBy: 'anonymous' });
                store[prefixedName] = migrated;
                rules[ruleName] = { yaml: rawYaml, savedBy: 'anonymous', savedAt: new Date().toISOString() };
              }
            }
          }
          return rules;
        } catch (e) {
          console.warn('Could not read saved rules from redis', e);
          return {};
        }
      }),

    getActive: modOnlyProcedure.query(async () => {
      try {
        const c = context as any;
        const subredditName = getCleanSubredditName();
        if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
        const subreddit = { name: subredditName };
        const key = `active_rule:${subreddit.name}`;
        let val: string | null = null;
        if (c && c.redis) {
          val = await c.redis.get(key);
        } else {
          const store: Record<string, string> = (globalThis as any).__ruleforge_active ||= {};
          val = store[subreddit.name] ?? null;
        }

        if (!val) {
          return { name: null, yaml: null, activatedAt: null };
        }

        try {
          const parsed = JSON.parse(val);
          return {
            name: typeof parsed.name === 'string' ? parsed.name : null,
            yaml: typeof parsed.yaml === 'string' ? parsed.yaml : null,
            activatedAt: typeof parsed.activatedAt === 'string' ? parsed.activatedAt : null,
          };
        } catch {
          return { name: null, yaml: val, activatedAt: null };
        }
      } catch (e) {
        console.warn('Could not read active rule', e);
        return { name: null, yaml: null, activatedAt: null };
      }
    }),

    activate: modOnlyProcedure
      .input(z.object({
        yaml: z.string()
          .min(1, 'Rule cannot be empty')
          .max(5000, 'Rule too long — max 5000 characters')
          .refine(val => !val.includes('javascript:') && !val.includes('<script'), 'Invalid rule content'),
        name: z.string().optional(),
      }))
      .mutation(async ({ input }: { input: { yaml: string; name?: string } }) => {
        try {
          const c = context as any;
          const subredditName = getCleanSubredditName();
          if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
          const subreddit = { name: subredditName };
          const key = `active_rule:${subreddit.name}`;
          const payload = JSON.stringify({
            yaml: input.yaml,
            name: input.name ?? null,
            activatedAt: new Date().toISOString(),
          });

          if (c && c.redis) {
            await c.redis.set(key, payload);
          } else {
            const store: Record<string, string> = (globalThis as any).__ruleforge_active ||= {};
            store[subreddit.name] = payload;
          }

          return {
            success: true,
            name: input.name ?? null,
            activatedAt: new Date().toISOString(),
          };
        } catch (e) {
          return { success: false, error: String(e), name: null, activatedAt: null };
        }
      }),

    // rename saved rule
    rename: modOnlyProcedure
      .input(z.object({ oldName: z.string(), newName: z.string() }))
      .mutation(async ({ input }: { input: { oldName: string; newName: string } }) => {
        try {
          const c = context as any;
          const subredditName = getCleanSubredditName();
          if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
          const subreddit = { name: subredditName };
          if (c && c.redis) {
            const oldKey = `saved_rule:${subreddit.name}:${input.oldName}`;
            const newKey = `saved_rule:${subreddit.name}:${input.newName}`;
            const val = await c.redis.get(oldKey);
            if (!val) return { success: false, error: 'not found' };
            await c.redis.set(newKey, val);
            await c.redis.del(oldKey);
            return { success: true };
          }
          const store: Record<string, string> = (globalThis as any).__ruleforge_saved ||= {};
          const oldPrefixedKey = `${subreddit.name}:${input.oldName}`;
          const newPrefixedKey = `${subreddit.name}:${input.newName}`;
          const oldVal = store[oldPrefixedKey];
          if (!oldVal) return { success: false, error: 'not found' };
          store[newPrefixedKey] = oldVal;
          delete store[oldPrefixedKey];
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      }),

    // delete saved rule
    delete: modOnlyProcedure
      .input(z.object({ name: z.string() }))
      .mutation(async ({ input }: { input: { name: string } }) => {
        try {
          const c = context as any;
          const subredditName = getCleanSubredditName();
          if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
          const subreddit = { name: subredditName };
          if (c && c.redis) {
            const key = `saved_rule:${subreddit.name}:${input.name}`;
            await c.redis.del(key);
            return { success: true };
          }
          const store: Record<string, string> = (globalThis as any).__ruleforge_saved ||= {};
          delete store[`${subreddit.name}:${input.name}`];
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      }),

    // simulate selected posts in read-only mode
    // ModSandbox is READ ONLY — it never calls remove(), approve(), or report()
    // The matcher runs locally against post data, no actions are ever taken
    applyRule: modOnlyProcedure
      .input(z.object({
        yaml: z.string()
          .min(1, 'Rule cannot be empty')
          .max(5000, 'Rule too long — max 5000 characters')
          .refine(val => !val.includes('javascript:') && !val.includes('<script'), 'Invalid rule content'),
        postIds: z.array(z.string()),
        dryRun: z.boolean().optional(),
      }))
      .mutation(async ({ input }: { input: { yaml: string; postIds: string[]; dryRun?: boolean } }) => {
        try {
          const rule = parseAutoModRule(input.yaml);
          if (!rule.valid) return { success: false, error: rule.parseError };
          const subredditName = getCleanSubredditName();
          if (!subredditName) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Subreddit context is missing' });
          const subreddit = { name: subredditName };
          const listing = await reddit.getNewPosts({ subredditName: subreddit.name, limit: 200 });
          const posts = await listing.all();
          const shaped = posts.map(p => ({ id: (p as any).id, title: (p as any).title ?? '', body: (p as any).selftext ?? (p as any).body ?? '', author: (p as any).authorName ?? (p as any).author ?? '', url: (p as any).url ?? '', permalink: (p as any).permalink ?? '' }));
          const matches = matchPostsAgainstRule(shaped, rule).filter(m => input.postIds.includes(m.postId));
          return { success: true, results: { total: matches.length, matches, readOnly: true } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;