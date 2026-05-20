import './index.css';
import './main';

import React, { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { trpc } from './trpc';
import { parseAutoModRule } from '../shared/parser';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
import type { MatchResult } from '../shared/types';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type TestResult = NonNullable<RouterOutputs['rules']['test']['results']>;

export const App = () => {
  const [username, setUsername] = useState<string>('');
  const [yaml, setYaml] = useState(`type: submission
title (contains): [spam, free money, click here]
action: report
action_reason: Possible spam`);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'editor' | 'results'>('editor');
  const [activeRule, setActiveRule] = useState<{ name: string | null; yaml: string | null; activatedAt: string | null }>({
    name: null,
    yaml: null,
    activatedAt: null,
  });
  const [postLimit, setPostLimit] = useState<number>(100);

  const yamlError = React.useMemo(() => {
    if (!yaml.trim()) return null;
    const parsed = parseAutoModRule(yaml);
    return parsed.valid ? null : (parsed.parseError || 'Invalid AutoMod rule syntax');
  }, [yaml]);
  
  // New state for modals
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRules, setSavedRules] = useState<Record<string, string>>({});
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    void trpc.init.get.query().then(d => setUsername(d.username ?? ''));
    void trpc.rules.getActive.query().then((active) => {
      setActiveRule({ name: active.name, yaml: active.yaml, activatedAt: active.activatedAt });
    });
  }, []);

  const getErrorMessage = (error: unknown) => {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as any).message);
    }
    return String(error);
  };

  const runTest = async () => {
    if (!yaml.trim() || yamlError) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await trpc.rules.test.mutate({ yaml, limit: postLimit });
      if (!res.success) {
        setError(getErrorMessage(res.error));
      } else {
        setResults(res.results);
        setActiveTab('results');
      }
    } catch (e) {
      setError(getErrorMessage(e));
    }
    setLoading(false);
  };

  const handleSaveRule = async () => {
    if (!saveName.trim()) {
      setSaveError('Rule name is required');
      return;
    }
    try {
      setSaveError(null);
      await trpc.rules.save.mutate({ yaml, name: saveName });
      setSaveName('');
      setShowSaveModal(false);
      const saved = await trpc.rules.getSaved.query();
      setSavedRules(saved);
    } catch (e) {
      setSaveError('Could not save rule: ' + getErrorMessage(e));
    }
  };

  const handleLoadSaved = async () => {
    try {
      const saved = await trpc.rules.getSaved.query();
      setSavedRules(saved);
      setShowLoadModal(true);
    } catch (e) {
      setError('Could not load saved rules: ' + getErrorMessage(e));
    }
  };

  const loadRule = (name: string) => {
    if (savedRules[name]) {
      setYaml(savedRules[name]);
      setShowLoadModal(false);
      setActiveTab('editor');
    }
  };

  const activateRule = async () => {
    if (!yaml.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await trpc.rules.activate.mutate({ yaml, name: saveName.trim() || undefined });
      if (!res.success) {
        setError(res.error ?? 'Unable to activate rule');
      } else {
        setActiveRule({ name: res.name, yaml, activatedAt: res.activatedAt });
        setError(null);
      }
    } catch (e) {
      setError('Could not activate rule: ' + getErrorMessage(e));
    }
    setLoading(false);
  };

  const handleViewHistory = async () => {
    try {
      const h = await trpc.rules.history.query();
      setHistory(h || []);
      setShowHistoryModal(true);
    } catch (e) {
      setError('Could not fetch history: ' + getErrorMessage(e));
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="flex flex-col gap-2 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-orange-600">ModSandBox</span>
            <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full">Beta</span>
          </div>
          {username && <span className="text-sm text-gray-500">u/{username}</span>}
        </div>
        {activeRule.yaml && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-gray-600 dark:text-gray-400">
            <span>Active rule{activeRule.name ? `: ${activeRule.name}` : ''}</span>
            {activeRule.activatedAt && <span>Activated {new Date(activeRule.activatedAt).toLocaleString()}</span>}
          </div>
        )}
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0">
        <button
          onClick={() => setActiveTab('editor')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'editor' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Rule Editor
        </button>
        <button
          onClick={() => setActiveTab('results')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'results' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Results {results ? `(${results.totalMatched})` : ''}
        </button>
      </div>

      {/* Editor tab */}
      {activeTab === 'editor' && (
        <div className="flex flex-col flex-1 p-4 gap-3 overflow-auto">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Paste an AutoMod YAML rule below and test it against your subreddit's recent posts.
            </p>
            <details className="text-right">
              <summary className="cursor-help text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">YAML Help</summary>
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-200 dark:border-blue-800">
                <p className="font-mono text-[11px] leading-tight">
                  type: submission<br/>
                  title (contains): [spam, ads]<br/>
                  action: remove
                </p>
              </div>
            </details>
          </div>
          <textarea
            className="flex-1 min-h-[200px] font-mono text-sm p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400 shadow-sm"
            value={yaml}
            onChange={e => setYaml(e.target.value)}
            placeholder={`type: submission\ntitle (contains): spam\naction: remove`}
            spellCheck={false}
          />
          {yamlError && (
            <div className="text-xs text-red-750 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded-lg px-3 py-2 mt-1 shadow-sm">
              ⚠️ Syntax Warning: {yamlError}
            </div>
          )}
          <TipCard />
          <div className="text-xs text-gray-500 bg-gray-900 rounded-lg px-3 py-2 border border-gray-800 mb-3">
            🔒 ModSandBox is read-only. No actions are taken on real posts. Results are simulations only.
          </div>
          {error && (
            <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded-lg px-4 py-3 shadow-sm">
              <p className="font-semibold">Error</p>
              <p className="text-xs mt-1 break-words">{error}</p>
            </div>
          )}
          {/* Dynamic Sample Size Selector */}
          <div className="flex items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-200 dark:border-gray-700 mb-1">
            <span className="font-medium">Recent posts to analyze:</span>
            <select
              value={postLimit}
              onChange={(e) => setPostLimit(Number(e.target.value))}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-500 font-medium text-xs text-gray-900 dark:text-gray-100 animate-fade-in"
            >
              <option value={50}>50 posts</option>
              <option value={100}>100 posts (Standard)</option>
              <option value={200}>200 posts (Deep scan)</option>
            </select>
          </div>
          <button
            onClick={runTest}
            disabled={loading || !yaml.trim() || !!yamlError}
            title={`Fetch the most recent subreddit posts and evaluate this rule against them (up to ${postLimit} posts).`}
            className="w-full py-3 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold transition-colors shadow-md cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? 'Fetching recent posts…' : 'Run Test'}
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Tests only the most recent subreddit posts, up to {postLimit} posts per run; this is not a full archive scan.</p>
          <div className="flex gap-2 mt-3">
            <button 
              onClick={() => setShowSaveModal(true)} 
              title="Save this rule with a custom name for later use"
              className="flex-1 py-2 rounded-lg bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800 font-medium transition inline-flex items-center justify-center gap-2"
            >
              <Icon path="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM14 2v6h4" />
              Save
            </button>
            <button 
              onClick={handleLoadSaved} 
              title="Load a previously saved rule"
              className="flex-1 py-2 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 font-medium transition inline-flex items-center justify-center gap-2"
            >
              <Icon path="M3 7a2 2 0 0 1 2-2h5l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              Load
            </button>
            <button 
              onClick={handleViewHistory} 
              title="View your test history and previous test results"
              className="flex-1 py-2 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 font-medium transition inline-flex items-center justify-center gap-2"
            >
              <Icon path="M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm.75 2.75V12l2.25 1.35" />
              History
            </button>
          </div>
        </div>
      )}

      {/* Save Rule Modal */}
      {showSaveModal && (
        <Modal title="Save Rule" onClose={() => { setShowSaveModal(false); setSaveError(null); }}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Give your rule a memorable name</p>
          <input
            type="text"
            placeholder="e.g., 'Spam Filter', 'Adult Content'"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-400"
          />
          {saveError && <p className="text-sm text-red-600 dark:text-red-400 mt-3 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded">{saveError}</p>}
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSaveRule}
              className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition"
            >
              Save
            </button>
            <button
              onClick={() => { setShowSaveModal(false); setSaveError(null); }}
              className="flex-1 py-2 rounded-lg bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-400 transition"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Load Saved Modal */}
      {showLoadModal && (
        <Modal title="Load Saved Rule" onClose={() => setShowLoadModal(false)}>
          {Object.keys(savedRules).length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500 dark:text-gray-400">No saved rules yet. Create one by clicking Save.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-auto">
              <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2">Click a rule to load it into the editor</p>
              {Object.keys(savedRules).map((name) => (
                <button
                  key={name}
                  onClick={() => loadRule(name)}
                  title={`Load rule: ${name}`}
                  className="w-full text-left px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-800 transition text-gray-900 dark:text-gray-100 border border-blue-200 dark:border-blue-700"
                >
                  <p className="font-medium text-sm">{name}</p>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowLoadModal(false)}
            className="w-full mt-4 py-2 rounded-lg bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-400 transition"
          >
            Close
          </button>
        </Modal>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <Modal title="Test History" onClose={() => setShowHistoryModal(false)}>
          {history.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500 dark:text-gray-400">No test history yet. Run a test to get started.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-auto">
              <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2">Recent test runs (newest first)</p>
              {history.map((run: any, i: number) => (
                <div
                  key={i}
                  className="px-4 py-3 rounded-lg bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700"
                >
                  <p className="font-semibold text-purple-700 dark:text-purple-300">{run.results.totalMatched} / {run.results.totalTested} matches</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{new Date(run.results.runAt).toLocaleString()}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 truncate italic">Rule: {run.yaml.substring(0, 60)}{run.yaml.length > 60 ? '...' : ''}</p>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowHistoryModal(false)}
            className="w-full mt-4 py-2 rounded-lg bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-400 transition"
          >
            Close
          </button>
        </Modal>
      )}

      {/* Results tab */}
      {activeTab === 'results' && (
        <div className="flex flex-col flex-1 overflow-auto">
          {!results && !loading && (
            <div className="flex flex-col items-center justify-center flex-1 text-gray-400 gap-2">
              <p className="text-sm">Run a test to see results here</p>
            </div>
          )}
          {results && (
            <>
              <div className="flex flex-col gap-3 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Your rule matched recent posts. Compare those matches with the subreddit mod log to validate precision and recall.</p>
                  <button
                    onClick={activateRule}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white px-4 py-2 text-sm font-semibold transition"
                  >
                    Activate Rule
                  </button>
                </div>
                {activeRule.name && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">Current active rule: {activeRule.name}</p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <MetricCard label="Posts tested" value={results.totalTested} />
                <MetricCard label="Matches" value={results.totalMatched} accent />
                <MetricCard label="True positives" value={results.truePositiveCount ?? 0} />
                <MetricCard label="False negatives" value={results.falseNegativeCount ?? 0} />
              </div>
              <div className="grid grid-cols-2 gap-2 p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <MetricCard label="Precision" value={results.precision != null ? `${results.precision}%` : '—'} />
                <MetricCard label="Recall" value={results.recall != null ? `${results.recall}%` : '—'} />
              </div>
              <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                <p>Compared against {results.modLogSummary?.fetched ?? 0} mod-log entries. {results.modLogSummary?.used ?? 0} of those refer to posts included in this test window.</p>
                {results.falseNegativeCount > 0 ? (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-300">Warning: your rule missed {results.falseNegativeCount} actioned post{results.falseNegativeCount === 1 ? '' : 's'} from the mod log.</p>
                ) : (
                  <p className="mt-1 text-sm text-green-700 dark:text-green-300">Great — no relevant auto-moderated posts were missed in this comparison window.</p>
                )}
              </div>

              {/* Match list */}
              <div className="flex-1 overflow-auto divide-y divide-gray-100 dark:divide-gray-800">
                {results.matches.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                    <p className="text-sm">No matches — rule would not have triggered on recent posts</p>
                  </div>
                )}
                {results.matches.map(match => (
                  <MatchCard key={match.postId} match={match} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

function MetricCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center py-3 px-2 bg-white dark:bg-gray-800">
      <span className={`text-xl font-bold ${accent ? 'text-orange-600' : 'text-gray-900 dark:text-gray-100'}`}>
        {value}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400 text-center">{label}</span>
    </div>
  );
}

function MatchCard({ match }: { match: MatchResult }) {
  return (
    <div className="px-4 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750">
      {/* Highlighted title */}
      <p className="text-sm font-medium mb-1 leading-snug">
        {match.highlights.map((seg, i) =>
          seg.highlighted ? (
            <mark key={i} className="bg-orange-200 dark:bg-orange-800 text-orange-900 dark:text-orange-100 rounded px-0.5">
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </p>
      {/* Meta */}
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>u/{match.author}</span>
        <span>·</span>
        <span className="text-orange-500">
          {match.matchedConditions.map(c => `${c.field}:${c.operator}`).join(', ')}
        </span>
      </div>
    </div>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function TipCard() {
  return (
    <div
      className="rounded-xl border border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 p-4 text-sm text-orange-900 dark:text-orange-100 shadow-sm mt-4"
      title="Use the YAML editor to build a rule, then click Run Test to validate it against recent subreddit posts. Save rules for later reuse."
    >
      <p className="font-semibold mb-2">ModSandBox Tip</p>
      <ul className="space-y-1 list-disc list-inside text-xs text-orange-900 dark:text-orange-200">
        <li>Use <code>title (contains)</code> or <code>body (contains)</code> to match keywords.</li>
        <li>Run Test evaluates recent posts (50, 100, or 200 posts) based on your selection.</li>
        <li>Save a rule once and reuse it later from the Load panel.</li>
      </ul>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[90%] max-w-lg bg-white dark:bg-gray-800 rounded-xl p-5 shadow-2xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <button 
            onClick={onClose} 
            title="Close this dialog"
            className="text-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
          >
            ✕
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);