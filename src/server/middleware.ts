import { TRPCError } from '@trpc/server';
import { reddit } from '@devvit/web/server';

export const createModOnlyProcedure = <TProcedure>(procedure: TProcedure) => {
  const decorated = (procedure as any).use(async (opts: any) => {
    const { next } = opts;
    const username = await reddit.getCurrentUsername();
    if (!username) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You must be logged in',
      });
    }

    const currentUser = await reddit.getCurrentUser();
    const subreddit = await reddit.getCurrentSubreddit();
    const mods = await reddit.getModerators({ subredditName: subreddit.name }).all();

    const isMod = mods.some(mod => mod.username === currentUser?.username);
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
