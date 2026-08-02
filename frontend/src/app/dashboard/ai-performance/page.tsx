'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Bot, Activity, Zap, AlertCircle, Loader2, RefreshCw, CheckCircle, Sparkles,
} from '../../../components/icons';
import { aiEngineApi } from '../../../lib/api';

interface StageHealth {
  stage: string;
  runs: number;
  succeeded: number;
  failed: number;
  successRate: number;
  avgMs: number;
  p95Ms: number;
}

interface AiMetrics {
  period: { days: number; from: string; to: string };
  pipeline: {
    totalRuns: number;
    succeeded: number;
    failed: number;
    successRate: number;
    byStage: StageHealth[];
  };
  confidence: {
    average: number | null;
    scored: number;
    bands: { label: string; range: string; count: number; share: number }[];
  };
  accuracy: {
    drafts: number;
    corrected: number;
    correctionRate: number | null;
    approved: number;
    rejected: number;
    pending: number;
  };
  models: { modelUsed: string; runs: number }[];
  tokens: { total: number };
  recentFailures: { stage: string; errorMessage: string | null; at: string }[];
}

// Muted semantics matching the analytics page: the three confidence bands map
// to "needs work", "normal", "good" rather than an arbitrary rainbow.
const BAND_COLORS = ['#df6a52', '#d6a24a', '#37b699'];

const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)}%`;

const humanStage = (stage: string) =>
  stage
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="glass-card row" style={{ padding: 22, alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <div className="t-eyebrow" style={{ marginBottom: 9 }}>{label}</div>
        <div className="metric" style={{ fontSize: '1.75rem' }}>{value}</div>
        {hint && (
          <div className="t-muted" style={{ fontSize: '0.75rem', marginTop: 6, maxWidth: 220 }}>
            {hint}
          </div>
        )}
      </div>
      <span
        className="row"
        style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', justifyContent: 'center', flexShrink: 0 }}
      >
        <Icon size={17} />
      </span>
    </div>
  );
}

interface DemandRow {
  query: string;
  requests: number;
  customers: number;
  reason: string;
  lastAskedAt: string;
}

interface DemandSummary {
  totalRequests: number;
  distinctQueries: number;
  top: DemandRow[];
}

export default function AiPerformancePage() {
  const [data, setData] = useState<AiMetrics | null>(null);
  const [demand, setDemand] = useState<DemandSummary | null>(null);
  const [days, setDays] = useState(7);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [metricsRes, demandRes] = await Promise.all([
        aiEngineApi.getMetrics(days),
        aiEngineApi.getUnfulfilledDemand(days),
      ]);
      setData(metricsRes.data.data);
      setDemand(demandRes.data.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load AI metrics');
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  if (isLoading && !data) {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: '100px 0' }}>
        <Loader2 size={28} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card row" style={{ gap: 10, padding: 24, color: 'var(--danger)' }}>
        <AlertCircle size={18} /> {error}
      </div>
    );
  }

  if (!data) return null;

  const bandChart = data.confidence.bands.map((b) => ({
    name: b.range,
    label: b.label,
    count: b.count,
  }));

  // Running on the mock extractor produces canned output, so every number on
  // this page describes the mock rather than real model quality. Worth saying
  // plainly instead of letting the figures be read as production accuracy.
  const mockRuns = data.models
    .filter((m) => m.modelUsed.startsWith('mock'))
    .reduce((sum, m) => sum + m.runs, 0);
  const mockShare = data.pipeline.totalRuns > 0 ? mockRuns / data.pipeline.totalRuns : 0;

  return (
    <div className="stack" style={{ gap: 22 }}>
      {/* Header */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>AI Performance</h1>
          <div className="sub">
            Pipeline health and extraction quality over the last {data.period.days} days
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => void fetchMetrics()}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {mockShare > 0 && (
        <div className="card row" style={{ gap: 10, padding: 14, alignItems: 'flex-start' }}>
          <Sparkles size={16} style={{ color: 'var(--warn, #d6a24a)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: '0.85rem' }}>
            <strong>{pct(mockShare)} of runs used the mock extractor.</strong>{' '}
            <span className="t-muted">
              Mock output is canned, so these figures measure the mock — not real model
              quality. Set GEMINI_API_KEY to get meaningful numbers.
            </span>
          </div>
        </div>
      )}

      {/* Headline stats */}
      <div className="grid-auto">
        <StatCard
          label="Owner correction rate"
          value={pct(data.accuracy.correctionRate)}
          hint={`${data.accuracy.corrected} of ${data.accuracy.drafts} drafts needed an edit before approval`}
          icon={Bot}
        />
        <StatCard
          label="Pipeline success"
          value={pct(data.pipeline.successRate)}
          hint={`${data.pipeline.failed} failed of ${data.pipeline.totalRuns} stage runs`}
          icon={Activity}
        />
        <StatCard
          label="Average confidence"
          value={data.confidence.average === null ? '—' : data.confidence.average.toFixed(2)}
          hint={`${data.confidence.scored} orders scored`}
          icon={CheckCircle}
        />
        <StatCard
          label="Tokens used"
          value={data.tokens.total.toLocaleString()}
          hint={`${data.accuracy.approved} approved · ${data.accuracy.rejected} rejected · ${data.accuracy.pending} pending`}
          icon={Zap}
        />
      </div>

      {/* Confidence distribution */}
      <div className="card stack" style={{ gap: 14, padding: 22 }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Confidence distribution</h3>
          <div className="t-muted" style={{ fontSize: '0.8rem' }}>
            Bands defined by BUSINESS_RULES §10 — below 0.80 returns to the customer for
            clarification, 0.80–0.95 needs owner review, 0.95+ is auto-approve eligible.
          </div>
        </div>
        {data.confidence.scored === 0 ? (
          <div className="t-muted" style={{ padding: '30px 0', textAlign: 'center' }}>
            No orders scored in this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={bandChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--ink-3)" fontSize={12} />
              <YAxis stroke="var(--ink-3)" fontSize={12} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'var(--surface-3)' }}
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}
                // The x-axis shows the numeric range; the tooltip label spells
                // out which §10 band that range means.
                labelFormatter={(range) =>
                  bandChart.find((b) => b.name === range)?.label ?? String(range)
                }
                formatter={(value) => [String(value), 'Orders']}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {bandChart.map((_, i) => (
                  <Cell key={i} fill={BAND_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Stage health */}
      <div className="card table-scroll" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px 0' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Pipeline stages</h3>
          <div className="t-muted" style={{ fontSize: '0.8rem' }}>
            p95 latency matters more than the average — the tail is what customers feel.
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Stage</th><th>Runs</th><th>Failed</th><th>Success</th><th>Avg</th><th>p95</th>
            </tr>
          </thead>
          <tbody>
            {data.pipeline.byStage.length === 0 ? (
              <tr><td colSpan={6} className="t-muted" style={{ textAlign: 'center', padding: 30 }}>
                No pipeline activity in this period.
              </td></tr>
            ) : (
              data.pipeline.byStage.map((s) => (
                <tr key={s.stage}>
                  <td>{humanStage(s.stage)}</td>
                  <td>{s.runs}</td>
                  <td style={{ color: s.failed > 0 ? 'var(--danger)' : undefined }}>{s.failed}</td>
                  <td>{pct(s.successRate)}</td>
                  <td>{s.avgMs} ms</td>
                  <td>{s.p95Ms} ms</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Unfulfilled demand — a stocking signal, not an error list */}
      <div className="card table-scroll" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px 0' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>
            Customers asked for products you don&apos;t have
          </h3>
          <div className="t-muted" style={{ fontSize: '0.8rem' }}>
            {demand && demand.totalRequests > 0
              ? `${demand.totalRequests} requests across ${demand.distinctQueries} products the catalogue could not match. Ranked by number of distinct customers — five people asking once each is a stronger signal than one person asking five times.`
              : 'Every request the AI cannot match is recorded here.'}
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>They asked for</th><th>Customers</th><th>Requests</th><th>Why</th><th>Last asked</th>
            </tr>
          </thead>
          <tbody>
            {!demand || demand.top.length === 0 ? (
              <tr><td colSpan={5} className="t-muted" style={{ textAlign: 'center', padding: 30 }}>
                Nothing unmatched in this period — every request found a product.
              </td></tr>
            ) : (
              demand.top.map((d) => (
                <tr key={`${d.query}-${d.reason}`}>
                  <td style={{ fontWeight: 500 }}>{d.query}</td>
                  <td>{d.customers}</td>
                  <td>{d.requests}</td>
                  <td className="t-muted" style={{ fontSize: '0.8rem' }}>
                    {d.reason === 'EMPTY_CATALOG'
                      ? 'No products synced'
                      : d.reason === 'OUT_OF_STOCK'
                        ? 'Out of stock'
                        : 'Not in catalogue'}
                  </td>
                  <td className="t-muted" style={{ fontSize: '0.8rem' }}>
                    {new Date(d.lastAskedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Models + recent failures */}
      <div className="ai-split">
        <div className="card stack" style={{ gap: 12, padding: 22 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Models used</h3>
          {data.models.length === 0 ? (
            <div className="t-muted">No runs in this period.</div>
          ) : (
            data.models.map((m) => (
              <div key={m.modelUsed} className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.875rem' }}>{m.modelUsed}</span>
                <span className="t-muted" style={{ fontSize: '0.875rem' }}>{m.runs} runs</span>
              </div>
            ))
          )}
        </div>

        <div className="card stack" style={{ gap: 12, padding: 22 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent failures</h3>
          {data.recentFailures.length === 0 ? (
            <div className="t-muted">No failures — nothing to investigate.</div>
          ) : (
            data.recentFailures.map((f, i) => (
              <div key={i} className="stack" style={{ gap: 2 }}>
                <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{humanStage(f.stage)}</span>
                  <span className="t-muted" style={{ fontSize: '0.75rem' }}>
                    {new Date(f.at).toLocaleString()}
                  </span>
                </div>
                <div className="t-muted" style={{ fontSize: '0.78rem' }}>
                  {f.errorMessage ?? 'No error message recorded'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .ai-split {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 16px;
        }
      `}</style>
    </div>
  );
}
