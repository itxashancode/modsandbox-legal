// Central Devvit config to enable Reddit API and Redis for client context
// This ensures `context.reddit` and `context.redis` are available.
// @ts-ignore: Devvit is injected by the Devvit runtime
declare const Devvit: any;

// @ts-ignore
if (typeof Devvit !== 'undefined' && Devvit?.configure) {
  Devvit.configure({
    redditAPI: true, // gives you context.reddit.*
    redis: true,     // gives you context.redis.*
  });
}

export {};
