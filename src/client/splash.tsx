import './index.css';
import './main';

import { navigateTo, requestExpandedMode, context } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const getTip = () => {
  const tips = [
    'Did you know? A single bad AutoMod rule can nuke hundreds of legitimate posts in minutes.',
    'Pro tip: Test your regex rules here before they wreak havoc on your community.',
    'Fun fact: Most mod cleanup work happens because AutoMod rules were never tested.',
    'Heads up: False positives frustrate good users. Test first, deploy with confidence.',
    'Reminder: Your community trusts you. ModSandbox helps you keep that trust.',
  ];
  return tips[Math.floor(Math.random() * tips.length)];
};

export const Splash = () => {
  const username = context.username ?? 'Moderator';
  const greeting = getGreeting();
  const tip = getTip();

  return (
    <div className="relative flex min-h-full h-full flex-col items-center justify-center gap-6 bg-[#0f1117] text-white px-6">
      
      {/* Logo mark */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-600 text-3xl font-black shadow-lg shadow-orange-900/40">
          M
        </div>
        <span className="text-xs tracking-widest text-orange-400 uppercase font-semibold">ModSandbox</span>
      </div>

      {/* Greeting */}
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-bold text-white">
          {greeting}, u/{username} 👋
        </h1>
        <p className="text-sm text-gray-400 max-w-xs leading-relaxed">
          Your AutoMod rule testing environment. No more pushing rules live and hoping for the best.
        </p>
      </div>

      {/* Tip card */}
      <div className="w-full max-w-sm rounded-xl border border-orange-900/40 bg-orange-950/30 px-4 py-3">
        <p className="text-xs text-orange-300 font-semibold uppercase tracking-wide mb-1">💡 Mod Tip</p>
        <p className="text-sm text-orange-100 leading-relaxed">{tip}</p>
      </div>

      {/* CTA */}
      <button
        className="w-full max-w-sm py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white font-bold text-base transition-colors shadow-lg shadow-orange-900/30"
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
      >
        Open Rule Tester →
      </button>

      {/* Stats row — static for now, can wire to real data later */}
      <div className="flex items-center gap-6 text-center">
        <div>
          <p className="text-lg font-bold text-white">100</p>
          <p className="text-xs text-gray-500">Posts tested</p>
        </div>
        <div className="w-px h-8 bg-gray-700" />
        <div>
          <p className="text-lg font-bold text-white">0ms</p>
          <p className="text-xs text-gray-500">Deploy risk</p>
        </div>
        <div className="w-px h-8 bg-gray-700" />
        <div>
          <p className="text-lg font-bold text-orange-400">Live</p>
          <p className="text-xs text-gray-500">Results</p>
        </div>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-4 flex gap-4 text-xs text-gray-600">
        <button onClick={() => navigateTo('https://developers.reddit.com/docs')} className="hover:text-gray-400 transition-colors">Docs</button>
        <span>|</span>
        <button onClick={() => navigateTo('https://www.reddit.com/r/Devvit')} className="hover:text-gray-400 transition-colors">r/Devvit</button>
        <span>|</span>
        <button onClick={() => navigateTo('https://discord.com/invite/R7yu2wh9Qz')} className="hover:text-gray-400 transition-colors">Discord</button>
      </footer>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
