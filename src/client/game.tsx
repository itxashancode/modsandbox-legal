import './index.css';
import './main';
import { navigateTo, context } from '@devvit/web/client';

import React, { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { trpc } from './trpc';
import { parseAutoModRule } from '../shared/parser';
import { buildHighlights } from '../shared/matcher';
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
  
  // New state for modals and notifications
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRules, setSavedRules] = useState<Record<string, { yaml: string; savedBy?: string; savedAt?: string }>>({});
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<'sm' | 'md' | 'lg'>('md');

  // Extract subreddit name from Devvit context
  const subredditName = context.subredditName || 'ruleforge_sub';

  useEffect(() => {
    void trpc.init.get.query().then(d => {
      const raw = d.username ?? 'anonymous';
      const clean = raw.split(',')[0]?.trim() ?? 'anonymous';
      setUsername(clean);
    });
    void trpc.rules.getActive.query().then((active) => {
      setActiveRule({ name: active.name, yaml: active.yaml, activatedAt: active.activatedAt });
    });
  }, []);

  // Sync state with local storage cache when subredditName loads
  useEffect(() => {
    const rulesKey = `ruleforge_saved_rules:${subredditName}`;
    const localSaved = JSON.parse(localStorage.getItem(rulesKey) || '{}');
    setSavedRules(localSaved);

    const histKey = `ruleforge_test_history:${subredditName}`;
    const localHist = JSON.parse(localStorage.getItem(histKey) || '[]');
    setHistory(localHist);
  }, [subredditName]);

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
        
        // Append run to subreddit-scoped local history
        const histKey = `ruleforge_test_history:${subredditName}`;
        const localHist = JSON.parse(localStorage.getItem(histKey) || '[]');
        const runItem = {
          yaml,
          results: {
            ...res.results,
            moderator: username || 'anonymous',
          },
        };
        localHist.unshift(runItem);
        const sliced = localHist.slice(0, 50);
        localStorage.setItem(histKey, JSON.stringify(sliced));
        setHistory(sliced);
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
      // Attempt backend save (persists globally for all moderators)
      await trpc.rules.save.mutate({ yaml, name: saveName });
    } catch (e) {
      console.warn('Backend save mutation failed, relying on local caching:', e);
    }

    try {
      // Mirror to local storage cache (subreddit-scoped)
      const rulesKey = `ruleforge_saved_rules:${subredditName}`;
      const localSaved = JSON.parse(localStorage.getItem(rulesKey) || '{}');
      localSaved[saveName] = {
        yaml,
        savedBy: username || 'anonymous',
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(rulesKey, JSON.stringify(localSaved));

      // Fetch and merge
      let merged = { ...localSaved };
      try {
        const remoteSaved = await trpc.rules.getSaved.query();
        merged = { ...localSaved, ...remoteSaved };
      } catch (_) {}

      setSavedRules(merged);
      setSaveSuccess(`Rule "${saveName}" saved by u/${username || 'anonymous'} successfully!`);
      setSaveName('');
      setShowSaveModal(false);

      // Auto dismiss success toast after 3 seconds
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err) {
      setSaveError('Could not save rule: ' + getErrorMessage(err));
    }
  };

  const handleLoadSaved = async () => {
    const rulesKey = `ruleforge_saved_rules:${subredditName}`;
    const localSaved = JSON.parse(localStorage.getItem(rulesKey) || '{}');
    try {
      const remoteSaved = await trpc.rules.getSaved.query();
      const merged = { ...localSaved, ...remoteSaved };
      setSavedRules(merged);
    } catch (e) {
      console.warn('Could not load saved rules from remote, using local cache:', e);
      setSavedRules(localSaved);
    }
    setShowLoadModal(true);
  };

  const loadRule = (name: string) => {
    if (savedRules[name]) {
      setYaml(savedRules[name].yaml);
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
    const histKey = `ruleforge_test_history:${subredditName}`;
    const localHist = JSON.parse(localStorage.getItem(histKey) || '[]');
    try {
      const remoteHist = await trpc.rules.history.query();
      // Deduplicate and merge by timestamp descending
      const merged = [...localHist];
      const localRunTimes = new Set(localHist.map((x: any) => x.results?.runAt));
      for (const item of remoteHist) {
        if (item.results?.runAt && !localRunTimes.has(item.results.runAt)) {
          merged.push(item);
        }
      }
      merged.sort((a, b) => new Date(b.results?.runAt || 0).getTime() - new Date(a.results?.runAt || 0).getTime());
      const sliced = merged.slice(0, 50);
      setHistory(sliced);
      localStorage.setItem(histKey, JSON.stringify(sliced));
    } catch (e) {
      console.warn('Failed to fetch test history from remote, using local cache:', e);
      setHistory(localHist);
    }
    setShowHistoryModal(true);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
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
          className={`flex-1 text-center py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'editor' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Rule Editor
        </button>
        <button
          onClick={() => setActiveTab('results')}
          className={`flex-1 text-center py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'results' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Results {results ? `(${results.totalMatched})` : ''}
        </button>
      </div>

      {/* Editor tab */}
      {activeTab === 'editor' && (
        <div className="flex flex-col flex-1 p-4 gap-3 overflow-auto">
          {saveSuccess && (
            <div className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/40 border border-green-300 dark:border-green-800 rounded-lg px-4 py-3 shadow-md animate-fade-in flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>✅</span>
                <span className="font-semibold">{saveSuccess}</span>
              </div>
              <button 
                onClick={() => setSaveSuccess(null)}
                className="text-green-500 hover:text-green-750 font-bold px-2 py-0.5"
              >
                ✕
              </button>
            </div>
          )}
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
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <button 
              onClick={() => setShowSaveModal(true)} 
              title="Save this rule with a custom name for later use"
              className="flex-1 py-2.5 rounded-lg bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800 font-medium transition inline-flex items-center justify-center gap-2"
            >
              <Icon path="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM14 2v6h4" />
              Save
            </button>
            <button 
              onClick={handleLoadSaved} 
              title="Load a previously saved rule"
              className="flex-1 py-2.5 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 font-medium transition inline-flex items-center justify-center gap-2"
            >
              <Icon path="M3 7a2 2 0 0 1 2-2h5l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              Load
            </button>
            <button 
              onClick={handleViewHistory} 
              title="View your test history and previous test results"
              className="flex-1 py-2.5 rounded-lg bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800 font-medium transition inline-flex items-center justify-center gap-2"
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
              {Object.entries(savedRules).map(([name, item]) => (
                <button
                  key={name}
                  onClick={() => loadRule(name)}
                  title={`Load rule: ${name}`}
                  className="w-full text-left px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-800 transition text-gray-900 dark:text-gray-100 border border-blue-200 dark:border-blue-700 flex flex-col gap-1 cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-bold text-sm text-blue-700 dark:text-blue-300">{name}</span>
                    {item.savedBy && (
                      <span className="text-[10px] bg-blue-100 dark:bg-blue-950 px-1.5 py-0.5 rounded text-blue-800 dark:text-blue-200 font-medium">
                        u/{item.savedBy}
                      </span>
                    )}
                  </div>
                  {item.savedAt && <span className="text-[10px] text-gray-450 dark:text-gray-400">Saved on {new Date(item.savedAt).toLocaleString()}</span>}
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
                  className="px-4 py-3 rounded-lg bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-semibold text-purple-700 dark:text-purple-300">{run.results.totalMatched} / {run.results.totalTested} matches</span>
                    {run.results.moderator && (
                      <span className="text-[10px] bg-purple-100 dark:bg-purple-950 px-1.5 py-0.5 rounded text-purple-800 dark:text-purple-200 font-medium">
                        u/{run.results.moderator}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400">{new Date(run.results.runAt).toLocaleString()}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-450 mt-1 truncate italic">Rule: {run.yaml.substring(0, 60)}{run.yaml.length > 60 ? '...' : ''}</p>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-2 p-3 sm:p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <MetricCard label="Posts tested" value={results.totalTested} />
                <MetricCard label="Matches" value={results.totalMatched} accent />
                <MetricCard label="True positives" value={results.truePositiveCount ?? 0} />
                <MetricCard label="False negatives" value={results.falseNegativeCount ?? 0} />
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2 p-3 sm:p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <MetricCard label="Precision" value={results.precision != null ? `${results.precision}%` : '—'} />
                <MetricCard label="Recall" value={results.recall != null ? `${results.recall}%` : '—'} />
              </div>
              {/* Sample simulation tag */}
              {(results as any).isMockData && (
                <div className="mx-2 sm:mx-4 mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs rounded-lg shadow-sm animate-fade-in flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span>💡</span>
                    <span className="font-semibold text-[13px]">Simulated Sandbox Data Active</span>
                  </div>
                  <p className="leading-relaxed font-normal text-[11px] text-amber-855 dark:text-amber-300">
                    {username && username !== 'anonymous' ? (
                      <span>You are logged in as <strong className="font-semibold text-amber-950 dark:text-amber-200">u/{username}</strong>, but real posts could not be retrieved from <strong className="font-semibold text-amber-950 dark:text-amber-200">r/{subredditName || 'ruleforgetest'}</strong> (which might be empty or restricted). A high-fidelity mock dataset has been pre-loaded to let you safely design and validate rules.</span>
                    ) : (
                      <span>You are playtesting in an unauthenticated session. A high-fidelity mock dataset has been pre-loaded to let you safely design and validate rules.</span>
                    )}
                  </p>
                  <details className="mt-1 border-t border-amber-250/30 dark:border-amber-800/40 pt-2">
                    <summary className="cursor-pointer font-semibold text-amber-700 dark:text-amber-400 hover:underline select-none">
                      How do I analyze real posts from r/{subredditName || 'ruleforgetest'}?
                    </summary>
                    <ol className="list-decimal list-inside space-y-1.5 mt-2 pl-1 font-normal leading-relaxed text-[11px] text-amber-850 dark:text-amber-350">
                      <li>
                        <strong>Align Sessions:</strong> Make sure you are logged into Reddit in this browser with the <strong>EXACT same account</strong> you used for <code>devvit login</code> in your terminal.
                      </li>
                      <li>
                        <strong>Moderator Permissions:</strong> Ensure this logged-in account has active moderator privileges on <strong>r/{subredditName || 'ruleforgetest'}</strong>.
                      </li>
                      <li>
                        <strong>Refresh Subreddit:</strong> Reload the playtest browser tab to synchronize credentials. Real post and mod logs will be loaded automatically!
                      </li>
                    </ol>
                  </details>
                </div>
              )}

              <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                <p>Compared against {results.modLogSummary?.fetched ?? 0} mod-log entries. {results.modLogSummary?.used ?? 0} of those refer to posts included in this test window.</p>
                {results.falseNegativeCount > 0 ? (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-300">Warning: your rule missed {results.falseNegativeCount} actioned post{results.falseNegativeCount === 1 ? '' : 's'} from the mod log.</p>
                ) : (
                  <p className="mt-1 text-sm text-green-700 dark:text-green-300">Great — no relevant auto-moderated posts were missed in this comparison window.</p>
                )}
              </div>

              {/* Match list header with sizing adjustments */}
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-850/30 border-b border-gray-200 dark:border-gray-700/60 flex items-center justify-between shrink-0 select-none">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Affected Posts Preview ({results.matches.length})
                </span>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-0.5 shadow-sm text-[10px]">
                    <span className="text-gray-400 px-1 font-medium">Size:</span>
                    {(['sm', 'md', 'lg'] as const).map((sz) => (
                      <button
                        key={sz}
                        onClick={() => setPreviewSize(sz)}
                        title={`Switch post layout size to ${sz.toUpperCase()}`}
                        className={`px-1.5 py-0.5 rounded font-bold uppercase transition ${previewSize === sz ? 'bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-650 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-gray-400 italic hidden sm:inline">
                    Click title or button to expand body
                  </span>
                </div>
              </div>

              {/* Match list */}
              <div className="flex-1 overflow-auto divide-y divide-gray-150 dark:divide-gray-800">
                {results.matches.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500 gap-2">
                    <p className="text-sm font-medium">No matches found</p>
                    <p className="text-xs">Your rule would not have triggered on any of the recent {results.totalTested} posts.</p>
                  </div>
                )}
                {results.matches.map(match => (
                  <MatchCard key={match.postId} match={match} size={previewSize} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

function MatchCard({ match, size }: { match: MatchResult; size: 'sm' | 'md' | 'lg' }) {
  const [expanded, setExpanded] = useState(false);

  const cardPadding = { sm: 'px-3 py-2', md: 'px-4 py-3.5', lg: 'px-5 py-5' }[size];
  const titleSize = { sm: 'text-xs font-normal leading-normal', md: 'text-sm font-medium leading-snug', lg: 'text-base font-semibold leading-relaxed' }[size];
  const bodySize = { sm: 'text-[10px] p-2 mt-1.5 min-h-[40px] max-h-[250px]', md: 'text-xs p-3 mt-2 min-h-[60px] max-h-[400px]', lg: 'text-sm p-4 mt-2.5 min-h-[80px] max-h-[600px]' }[size];
  const metaSize = { sm: 'text-[9px] mt-1.5', md: 'text-[11px] mt-2', lg: 'text-xs mt-3' }[size];

  const bodyHighlights = React.useMemo(() => {
    if (!match.body) return [];
    const bodyConds = match.matchedConditions.filter(c => c.field === 'body');
    return buildHighlights(match.body, bodyConds);
  }, [match.body, match.matchedConditions]);

  return (
    <div className={`${cardPadding} bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 border-b border-gray-100 dark:border-gray-850 transition-all duration-200`}>
      <div className="flex justify-between items-start gap-4">
        {/* Title segments */}
        <div className="flex-1 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <p className={`${titleSize} text-gray-900 dark:text-gray-100`}>
            {match.highlights.map((seg, i) =>
              seg.highlighted ? (
                <mark key={i} className="bg-orange-250 dark:bg-orange-850 text-orange-950 dark:text-orange-100 rounded px-0.5 font-semibold">
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 font-semibold whitespace-nowrap shrink-0 transition cursor-pointer"
        >
          {expanded ? 'Collapse ▴' : 'Expand Preview ▾'}
        </button>
      </div>

      {expanded && match.body && (
        <div className={`text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-850/40 rounded-lg border border-gray-250 dark:border-gray-700/50 animate-fade-in font-normal leading-relaxed break-words resize-y overflow-auto ${bodySize}`}>
          {bodyHighlights.length > 0 ? (
            bodyHighlights.map((seg, i) =>
              seg.highlighted ? (
                <mark key={i} className="bg-orange-250 dark:bg-orange-850 text-orange-950 dark:text-orange-100 rounded px-0.5 font-semibold">
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )
          ) : (
            <span>{match.body}</span>
          )}
        </div>
      )}

      {/* Meta tags */}
      <div className={`flex items-center gap-3 text-gray-400 font-normal ${metaSize}`}>
        <span className="font-semibold text-gray-500 dark:text-gray-400">u/{match.author}</span>
        <span>·</span>
        <span className="text-orange-600 dark:text-orange-400 font-semibold bg-orange-50 dark:bg-orange-950/40 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider">
          {match.matchedConditions.map(c => `${c.field}:${c.operator}`).join(', ')}
        </span>
        {match.permalink && (
          <>
            <span>·</span>
            <button
              onClick={() => navigateTo(`https://reddit.com${match.permalink}`)}
              title="Open this post on Reddit"
              className="text-blue-500 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 cursor-pointer bg-transparent border-none p-0 font-normal"
              style={{ fontSize: 'inherit' }}
            >
              View Post ↗
            </button>
          </>
        )}
      </div>
    </div>
  );
}

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