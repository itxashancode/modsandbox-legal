import { TRPCError } from '@trpc/server';
import { reddit, context } from '@devvit/web/server';

export const createModOnlyProcedure = <TProcedure>(procedure: TProcedure) => {
  const decorated = (procedure as any).use(async (opts: any) => {
    const { next } = opts;
    const rawUsername = context.username;
    const username = rawUsername?.split(',')[0]?.trim();
    const rawSubredditName = context.subredditName;
    const subredditName = rawSubredditName?.split(',')[0]?.trim();

    console.log('[ModSandbox debug] middleware values:', { username, subredditName });
    if (!username) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You must be logged in',
      });
    }

    if (!subredditName) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Subreddit context is missing',
      });
    }

    try {
      const mods = await reddit.getModerators({ subredditName }).all();
      const isMod = mods.some(mod => mod.username === username);
      if (!isMod) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only moderators can use ModSandbox',
        });
      }
    } catch (e: any) {
      console.warn('[ModSandbox] Failed to verify moderator status via API:', e);
      if (e instanceof TRPCError) {
        throw e;
      }
      console.log('[ModSandbox] Allowing access in playtest/sandbox fallback mode');
    }

    return next();
  });
  return decorated as TProcedure;
};
