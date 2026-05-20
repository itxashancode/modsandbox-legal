import { TRPCError } from '@trpc/server';
import { reddit, context } from '@devvit/web/server';

export const createModOnlyProcedure = <TProcedure>(procedure: TProcedure) => {
  const decorated = (procedure as any).use(async (opts: any) => {
    const { next } = opts;
    const username = context.username;
    if (!username) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You must be logged in',
      });
    }

    const subredditName = context.subredditName;
    if (!subredditName) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Subreddit context is missing',
      });
    }

    const mods = await reddit.getModerators({ subredditName }).all();

    const isMod = mods.some(mod => mod.username === username);
    if (!isMod) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only moderators can use ModSandbox',
      });
    }

    return next();
  });
  return decorated as TProcedure;
};
