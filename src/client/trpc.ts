import { createTRPCClient, httpBatchStreamLink } from '@trpc/client';
import type { AppRouter } from '../server/trpc';
import { transformer } from '../shared/transformer';

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchStreamLink({
      url: '/api/trpc',
      transformer,
      headers() {
        const devvit = (globalThis as any).devvit;
        if (!devvit) return {};

        const headers: Record<string, string> = {};

        const ctx = devvit.context;
        if (ctx) {
          if (ctx.subredditId) headers['devvit-subreddit'] = ctx.subredditId;
          if (ctx.subredditName) headers['devvit-subreddit-name'] = ctx.subredditName;
          if (ctx.userId) headers['devvit-user'] = ctx.userId;
          if (ctx.username) headers['devvit-user-name'] = ctx.username;
          if (ctx.postId) headers['devvit-post'] = ctx.postId;
          if (ctx.commentId) headers['devvit-comment'] = ctx.commentId;
        }

        return headers;
      },
    }),
  ],
});

