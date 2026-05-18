import { useState, useEffect } from 'react';
import { runInsightsAnalysis, findLocalServices } from '../lib/api';

interface Insight {
  type: string;
  severity: string;
  title: string;
  description: string;
  affected: string[];
  recommendation: string;
  estimatedSavings: string | null;
}

const TYPE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  recurring_issue:   { label: 'Recurring Issue',    icon: '🔄', color: 'border-yellow-300 bg-yellow-50' },
  escalation_risk:   { label: 'Escalation Risk',    icon: '📈', color: 'border-red-300 bg-red-50' },
  cost_saving:       { label: 'Cost Saving',        icon: '💰', color: 'border-green-300 bg-green-50' },
  preventive_action: { label: 'Preventive Action',  icon: '🛡️', color: 'border-blue-300 bg-blue-50' },
  building_pattern:  { label: 'Building Pattern',   icon: '🏢', color: 'border-purple-300 bg-purple-50' },
};

const SEVERITY_BADGE: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-700',
  critical: 'bg-red-100 text-red-700',
};

export function Insights() {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [meta, setMeta] = useState<{ analyzedTickets: number; unitsAnalyzed: number; memoriesUsed: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRun, setLastRun] = useState<string | null>(null);

  const analyze = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await runInsightsAnalysis();
      if (res.error) {
        setError(res.error);
      } else {
        setInsights(res.insights || []);
        setMeta({
          analyzedTickets: res.analyzedTickets,
          unitsAnalyzed: res.unitsAnalyzed,
          memoriesUsed: res.memoriesUsed,
        });
      }
    } catch {
      setError('Analysis failed');
    }
    setLoading(false);
    setLastRun(new Date().toLocaleTimeString());
  };

  // Run on mount and every 60 seconds
  useEffect(() => {
    analyze();
    const interval = setInterval(analyze, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            Predictive Maintenance
            <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Live
            </span>
          </h1>
          <p className="text-sm text-gray-500">
            AI-powered pattern detection. Powered by Supermemory. Updates every 60s.
            {lastRun && <span className="text-gray-400 ml-1">Last: {lastRun}</span>}
          </p>
        </div>
        <button
          onClick={analyze}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Analyzing...
            </>
          ) : (
            'Refresh Now'
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-700">{error}</div>
      )}

      {/* Loading state on first run */}
      {!insights && loading && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Scanning Properties...</h2>
          <p className="text-sm text-gray-500">Analyzing tickets and querying Supermemory for patterns.</p>
        </div>
      )}

      {/* Results */}
      {insights && (
        <>
          {/* Stats bar */}
          {meta && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{meta.analyzedTickets}</p>
                <p className="text-xs text-gray-500">Tickets Analyzed</p>
              </div>
              <div className="bg-white rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{meta.unitsAnalyzed}</p>
                <p className="text-xs text-gray-500">Units Scanned</p>
              </div>
              <div className="bg-white rounded-lg border p-4 text-center">
                <p className="text-2xl font-bold text-purple-600">{meta.memoriesUsed}</p>
                <p className="text-xs text-gray-500">Supermemory Records Used</p>
              </div>
            </div>
          )}

          {insights.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
              <div className="text-3xl mb-2">✅</div>
              <h3 className="font-semibold text-green-800">All Clear</h3>
              <p className="text-sm text-green-600 mt-1">No concerning patterns detected. Properties are in good shape.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {insights.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface ServiceResult {
  name: string;
  rating: string;
  estimatedCost: string;
  pros: string;
  cons: string;
  url?: string;
}

function InsightCard({ insight }: { insight: Insight }) {
  const config = TYPE_CONFIG[insight.type] || TYPE_CONFIG.recurring_issue;
  const [searching, setSearching] = useState(false);
  const [serviceResults, setServiceResults] = useState<{
    topPick?: { name: string; reason: string };
    services: ServiceResult[];
    comparison?: string;
    suggestion?: string;
    searchQuery?: string;
    liveUrl?: string;
  } | null>(null);
  const [serviceError, setServiceError] = useState('');

  const handleFindServices = async () => {
    setSearching(true);
    setServiceError('');
    try {
      const category = insight.title.toLowerCase().includes('plumbing') ? 'plumbing'
        : insight.title.toLowerCase().includes('hvac') || insight.title.toLowerCase().includes('ac') ? 'HVAC'
        : insight.title.toLowerCase().includes('electri') ? 'electrical'
        : insight.type === 'building_pattern' ? 'building inspection'
        : 'maintenance';

      const res = await findLocalServices(category, insight.recommendation);
      if (res.error) {
        setServiceError(res.error);
      } else {
        setServiceResults(res);
      }
    } catch {
      setServiceError('Search failed');
    }
    setSearching(false);
  };

  return (
    <div className={`rounded-xl border-l-4 ${config.color} p-5`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{config.icon}</span>
          <h3 className="font-semibold text-gray-900 text-sm">{insight.title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {insight.estimatedSavings && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              Save {insight.estimatedSavings}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_BADGE[insight.severity] || SEVERITY_BADGE.info}`}>
            {insight.severity}
          </span>
        </div>
      </div>

      <p className="text-sm text-gray-700 mb-3">{insight.description}</p>

      <div className="flex items-start gap-4 text-xs">
        <div>
          <span className="text-gray-500 font-medium">Affected: </span>
          <span className="text-gray-700">
            {Array.isArray(insight.affected) ? insight.affected.join(', ') : insight.affected}
          </span>
        </div>
      </div>

      <div className="mt-3 bg-white bg-opacity-60 rounded-lg p-3 border border-gray-100">
        <p className="text-xs font-medium text-gray-500 mb-1">Recommendation</p>
        <p className="text-sm text-gray-800">{insight.recommendation}</p>
      </div>

      {/* Find Services button */}
      <div className="mt-3">
        {!serviceResults && !searching && (
          <button
            onClick={handleFindServices}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Find Local Services
          </button>
        )}

        {searching && (
          <div className="flex items-center gap-2 text-xs text-indigo-600">
            <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            Searching for local services via Browser Use...
          </div>
        )}

        {serviceError && (
          <p className="text-xs text-red-600 mt-1">{serviceError}</p>
        )}

        {/* Service Results */}
        {serviceResults && (
          <div className="mt-3 bg-white rounded-lg border border-indigo-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-indigo-900 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Local Services Found
              </h4>
              {serviceResults.searchQuery && (
                <span className="text-xs text-gray-400">"{serviceResults.searchQuery.slice(0, 40)}..."</span>
              )}
            </div>

            {/* Top Pick */}
            {serviceResults.topPick && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
                <p className="text-xs font-semibold text-green-800 mb-0.5">
                  Top Pick:{' '}
                  {(() => {
                    const match = serviceResults.services?.find(s => s.name === serviceResults.topPick?.name);
                    return match?.url
                      ? <a href={match.url} target="_blank" rel="noopener noreferrer" className="text-green-700 underline">{serviceResults.topPick.name} ↗</a>
                      : serviceResults.topPick!.name;
                  })()}
                </p>
                <p className="text-xs text-green-600">{serviceResults.topPick.reason}</p>
              </div>
            )}

            {/* Service comparison table */}
            {serviceResults.services && serviceResults.services.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 pr-3 text-gray-500 font-medium">Service</th>
                      <th className="text-left py-2 pr-3 text-gray-500 font-medium">Rating</th>
                      <th className="text-left py-2 pr-3 text-gray-500 font-medium">Est. Cost</th>
                      <th className="text-left py-2 pr-3 text-gray-500 font-medium">Pros</th>
                      <th className="text-left py-2 text-gray-500 font-medium">Cons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceResults.services.map((s: any, j: number) => {
                      const mapUrl = s.mapUrl || `https://www.google.com/maps/search/${encodeURIComponent(s.name + ' San Francisco Bay Area')}`;
                      const websiteUrl = s.url && s.url.startsWith('http') && !s.url.includes('google.com/maps') ? s.url : null;
                      return (
                      <tr key={j} className="border-b border-gray-50">
                        <td className="py-2 pr-3 font-medium">
                          <div>
                            <span className="text-gray-900">{s.name}</span>
                            <div className="flex gap-2 mt-0.5">
                              <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                Maps ↗
                              </a>
                              {websiteUrl ? (
                                <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">
                                  Website ↗
                                </a>
                              ) : (
                                <span className="text-xs text-gray-400">No website</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-gray-600">{s.rating || '—'}</td>
                        <td className="py-2 pr-3 text-gray-600">{s.estimatedCost || '—'}</td>
                        <td className="py-2 pr-3 text-gray-700 text-xs">
                          <ul className="list-disc list-inside space-y-0.5">
                            {(Array.isArray(s.pros) ? s.pros : [s.pros]).filter(Boolean).map((p: string, k: number) => (
                              <li key={k}>{p}</li>
                            ))}
                          </ul>
                        </td>
                        <td className="py-2 text-gray-700 text-xs">
                          <ul className="list-disc list-inside space-y-0.5">
                            {(Array.isArray(s.cons) ? s.cons : [s.cons]).filter(Boolean).map((c: string, k: number) => (
                              <li key={k}>{c}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Comparison summary */}
            {serviceResults.comparison && (
              <p className="text-xs text-gray-600 mt-3 italic">{serviceResults.comparison}</p>
            )}
            {serviceResults.suggestion && (
              <p className="text-xs text-indigo-700 mt-1 font-medium">{serviceResults.suggestion}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
