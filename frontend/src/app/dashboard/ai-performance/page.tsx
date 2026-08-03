'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  AreaChart,
  Area,
  CartesianGrid,
  LabelList,
  PieChart,
  Pie,
  Legend,
} from 'recharts';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  CheckCircle,
  Clock,
  Inbox,
  Search,
  Sparkles,
  TrendingUp,
} from '../../../components/icons';
import { aiEngineApi } from '../../../lib/api';

/**
 * Assistant activity — written for a shop owner, not an engineer.
 *
 * The previous version reported token counts, model identifiers, p95 stage
 * latency and raw provider error strings. All accurate, none of it answerable
 * by the person reading it. A dashboard that cannot be acted on is noise.
 *
 * Every number here answers one of three questions an owner actually has:
 *   1. Is it working?
 *   2. How much work did it save me?
 *   3. What should I do about it?
 *
 * Anything answering none of those was removed rather than reworded — the
 * fastest way to make a dashboard unreadable is to keep everything and shrink
 * the font.
 */

interface AiMetrics {
  period: { days: number; from: string; to: string };
  pipeline: { totalRuns: number; succeeded: number; failed: number; successRate: number };
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
  daily: { date: string; prepared: number; corrected: number }[];
  models: { modelUsed: string; runs: number }[];
  recentFailures: { stage: string; errorMessage: string | null; at: string }[];
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

/**
 * Minutes an owner spends on one WhatsApp order by hand — reading it, checking
 * stock, replying, writing it down. Deliberately conservative: a number that
 * flatters the product is worth nothing to someone deciding whether to keep
 * paying for it.
 */
const MINUTES_SAVED_PER_ORDER = 2;

/**
 * Outcomes in the owner's language, keyed by POSITION rather than by the
 * band's range string.
 *
 * The previous version matched on strings like '0.80 - 0.95'. The API emits
 * '0.8 – 0.95' — an en dash, and no trailing zero — so two of the three keys
 * silently missed and the page fell back to raw internal labels
 * ("Manual confirmation required"). Worse, the colours were applied by the
 * same index without accounting for order: the API returns bands worst-first,
 * so the LOWEST confidence band was painted green and "ready to send" red.
 *
 * The API contract is the order, not the wording, so that is what this keys on.
 */
const OUTCOMES = [
  {
    title: 'Asked the customer',
    meaning: 'Something was unclear, so it asked rather than guessed',
    color: '#df6a52',
  },
  {
    title: 'Needed your check',
    meaning: 'Mostly right, worth a glance before you approve',
    color: '#d6a24a',
  },
  {
    title: 'Ready to send',
    meaning: 'Confident enough to prepare the order for you',
    color: '#37b699',
  },
] as const;

/**
 * Provider errors are written for whoever runs the service. "Rate limit
 * reached for model llama-3.3-70b-versatile in organization org_01kz... on
 * tokens per day (TPD): Limit 100000, Used 99917" tells a shop owner nothing
 * they can act on, and reads like a fault they caused.
 */
function plainProblem(message: string | null): string {
  if (!message) return 'A message could not be handled and was skipped.';

  const m = message.toLowerCase();

  if (m.includes('rate limit') || m.includes('quota') || m.includes('tokens per')) {
    return 'The assistant reached its daily limit and paused. It resumes automatically.';
  }
  if (m.includes('timeout') || m.includes('etimedout') || m.includes('abort')) {
    return 'The assistant took too long to answer and gave up on that message.';
  }
  if (m.includes('api key') || m.includes('unauthorized') || m.includes('401')) {
    return 'The assistant could not sign in to its AI service. Check Settings.';
  }
  if (m.includes('econnrefused') || m.includes('network') || m.includes('fetch failed')) {
    return 'The assistant could not reach its AI service. Usually temporary.';
  }

  return 'A message could not be handled and was skipped.';
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  tone?: 'neutral' | 'good';
}) {
  return (
    <div className="card stat-card">
      <div className="stat-body">
        <div className="t-eyebrow">{label}</div>
        <div className="metric stat-value">{value}</div>
        <p className="t-muted stat-hint">{hint}</p>
      </div>
      <span
        className="row stat-icon"
        style={{
          background: tone === 'good' ? 'var(--success-soft)' : 'var(--brand-soft)',
          color: tone === 'good' ? 'var(--success)' : 'var(--brand)',
        }}
        aria-hidden="true"
      >
        <Icon size={17} />
      </span>
    </div>
  );
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
      setError('Could not load your assistant activity. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  if (isLoading && !data) {
    return (
      <div className="stack" style={{ gap: 12, alignItems: 'center', padding: '90px 0' }}>
        <Loader2 size={26} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
        <p className="t-muted">Loading your assistant activity…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card row" style={{ gap: 10, padding: 24, color: 'var(--danger)' }}>
        <AlertCircle size={18} /> {error ?? 'No activity yet.'}
      </div>
    );
  }

  const { accuracy, confidence, pipeline } = data;

  const cleanDrafts = accuracy.drafts - accuracy.corrected;
  const cleanShare = accuracy.drafts > 0 ? cleanDrafts / accuracy.drafts : null;

  const minutesSaved = accuracy.drafts * MINUTES_SAVED_PER_ORDER;
  const savedLabel =
    minutesSaved >= 60 ? `${(minutesSaved / 60).toFixed(1)} hrs` : `${minutesSaved} min`;

  // Reversed so the best outcome reads first — an owner wants "how much went
  // smoothly" before "how much needed me".
  const outcomes = confidence.bands
    .map((b, i) => ({
      name: OUTCOMES[i]?.title ?? b.label,
      meaning: OUTCOMES[i]?.meaning ?? '',
      count: b.count,
      fill: OUTCOMES[i]?.color ?? '#8c8577',
    }))
    .reverse();
  const totalOutcomes = outcomes.reduce((s, o) => s + o.count, 0);

  // Told plainly, rather than handing over a percentage to interpret.
  const healthy = pipeline.failed === 0 || pipeline.successRate >= 0.9;

  // Demo mode still matters to an owner — it means the figures are not real —
  // but it should not mention environment variables.
  const mockRuns = data.models
    .filter((m) => m.modelUsed.startsWith('mock'))
    .reduce((sum, m) => sum + m.runs, 0);
  const inDemoMode = pipeline.totalRuns > 0 && mockRuns / pipeline.totalRuns > 0.1;

  const trend = (data.daily ?? []).map((d) => ({
    // "4 Aug" reads faster than an ISO date on a crowded axis.
    label: new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    }),
    // Split so the chart answers volume AND quality at once: a rising line is
    // only good news if the amber band underneath is not rising with it.
    clean: Math.max(d.prepared - d.corrected, 0),
    corrected: d.corrected,
    prepared: d.prepared,
  }));
  const trendTotal = trend.reduce((sum, d) => sum + d.prepared, 0);

  const demandChart = (demand?.top ?? []).slice(0, 6).map((r) => ({
    name: r.query.length > 24 ? `${r.query.slice(0, 24)}…` : r.query,
    customers: r.customers,
  }));

  return (
    <div className="stack" style={{ gap: 18 }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="page-head">
        <div>
          <h1>Your assistant</h1>
          <div className="sub">What it handled for you over the last {days} days</div>
        </div>

        <div className="row head-actions">
          <div className="row seg" role="group" aria-label="Time period">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`seg-btn${days === d ? ' seg-btn-on' : ''}`}
                aria-pressed={days === d}
              >
                {d} days
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void fetchMetrics()}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Demo notice ────────────────────────────────────────── */}
      {inDemoMode && (
        <div className="card row notice">
          <Sparkles size={16} className="notice-icon" aria-hidden="true" />
          <p className="notice-text">
            <strong>Demo mode.</strong> Some replies came from built-in sample
            answers rather than the real assistant, so the numbers below are
            practice data. Connect your AI service in Settings to see real
            results.
          </p>
        </div>
      )}

      {/* ── Status ─────────────────────────────────────────────── */}
      <div
        className="card row status"
        style={{
          background: healthy ? 'var(--success-soft)' : 'var(--warning-soft)',
          borderColor: healthy ? 'var(--brand-line)' : 'var(--warning)',
        }}
      >
        <span
          className="row status-icon"
          style={{ color: healthy ? 'var(--success)' : 'var(--warning)' }}
          aria-hidden="true"
        >
          {healthy ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
        </span>
        <div>
          <strong className="status-title">
            {healthy ? 'Working normally' : 'Having some trouble'}
          </strong>
          <p className="t-muted status-text">
            {healthy
              ? 'Reading your messages and preparing orders as expected.'
              : 'Some messages were skipped. Nothing is lost — they just need handling the usual way.'}
          </p>
        </div>
      </div>

      {/* ── The numbers that matter ────────────────────────────── */}
      <div className="stat-grid">
        <StatCard
          label="Orders prepared"
          value={String(accuracy.drafts)}
          hint="Messages turned into an order for you"
          icon={Inbox}
        />
        <StatCard
          label="Right first time"
          value={cleanShare === null ? '—' : `${Math.round(cleanShare * 100)}%`}
          hint={
            accuracy.drafts === 0
              ? 'No orders yet in this period'
              : `${cleanDrafts} of ${accuracy.drafts} needed no changes`
          }
          icon={CheckCircle}
          tone="good"
        />
        <StatCard
          label="Time saved"
          value={savedLabel}
          hint={`About ${MINUTES_SAVED_PER_ORDER} minutes per order you did not type`}
          icon={Clock}
        />
        <StatCard
          label="Waiting for you"
          value={String(accuracy.pending)}
          hint="Sitting in your approval queue now"
          icon={AlertCircle}
        />
      </div>

      {/* ── Trend ──────────────────────────────────────────────── */}
      <div className="card panel">
        <div className="between sec-head">
          <div>
            <h2 className="sec-title">Orders prepared each day</h2>
            <p className="t-muted sec-sub">
              A single total hides whether things are improving. This does not.
            </p>
          </div>
          <span className="trend-total">{trendTotal} in {days} days</span>
        </div>

        {trendTotal === 0 ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <TrendingUp size={18} />
            </span>
            <p className="empty-head">No orders yet</p>
            <p className="t-muted empty-sub">Once customers start messaging, each day appears here.</p>
          </div>
        ) : (
          <div className="chart" aria-hidden="true">
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
                <defs>
                  <linearGradient id="preparedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.26} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="correctedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d6a24a" stopOpacity={0.26} />
                    <stop offset="100%" stopColor="#d6a24a" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--line)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={22}
                  tick={{ fill: 'var(--ink-3)', fontSize: 11 }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{ fill: 'var(--ink-3)', fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--line-strong)' }}
                  contentStyle={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    fontSize: '0.8125rem',
                  }}
                  formatter={(v, n) => [`${String(v)}`, String(n)]}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={26}
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span style={{ color: 'var(--ink-2)', fontSize: '0.75rem' }}>
                      {value}
                    </span>
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="clean"
                  name="Right first time"
                  stackId="1"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  fill="url(#preparedFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Area
                  type="monotone"
                  dataKey="corrected"
                  name="You edited"
                  stackId="1"
                  stroke="#d6a24a"
                  strokeWidth={2}
                  fill="url(#correctedFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Two columns on desktop: a single stacked column of full-width
          cards reads as a list, not a dashboard, and wastes the right
          half of every wide screen. */}
      <div className="split">
      {/* ── Outcomes ───────────────────────────────────────────── */}
      <div className="card panel">
        <div className="between sec-head">
          <h2 className="sec-title">What happened to each request</h2>
          {totalOutcomes > 0 && (
            <span className="trend-total">{totalOutcomes} requests</span>
          )}
        </div>
        <p className="t-muted sec-sub">
          Every customer message the assistant scored. It only turns one into
          an order when it is sure — otherwise it asks you, or asks the
          customer, instead of guessing.
        </p>

        {totalOutcomes === 0 ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <Inbox size={18} />
            </span>
            <p className="empty-head">Nothing scored yet</p>
            <p className="t-muted empty-sub">Send a test message from the WhatsApp page to see this fill in.</p>
          </div>
        ) : (
          <>
            {/* A donut carries a total in its centre and stays legible when
                one slice dominates — the flat stripe it replaces rendered as
                a single solid bar, which reads as an error, not a split. */}
            <div
              className="donut-wrap"
              role="img"
              aria-label={outcomes.map((o) => `${o.name}: ${o.count}`).join(', ')}
            >
              <ResponsiveContainer width="100%" height={168}>
                <PieChart>
                  <Pie
                    data={outcomes.filter((o) => o.count > 0)}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={76}
                    paddingAngle={outcomes.filter((o) => o.count > 0).length > 1 ? 3 : 0}
                    stroke="none"
                  >
                    {outcomes
                      .filter((o) => o.count > 0)
                      .map((o) => (
                        <Cell key={o.name} fill={o.fill} />
                      ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      borderRadius: 10,
                      fontSize: '0.8125rem',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-centre" aria-hidden="true">
                <span className="donut-value">{totalOutcomes}</span>
                <span className="donut-label">requests</span>
              </div>
            </div>

            <ul className="legend">
              {outcomes.map((o) => (
                <li key={o.name} className="legend-item">
                  <span className="swatch" style={{ background: o.fill }} aria-hidden="true" />
                  <div className="legend-copy">
                    <div className="legend-head">
                      <strong>{o.name}</strong>
                      <span className="legend-count">
                        {o.count}
                        {totalOutcomes > 0 && (
                          <span className="legend-share">
                            {' '}
                            ({Math.round((o.count / totalOutcomes) * 100)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="t-muted legend-meaning">{o.meaning}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ── Missed demand ──────────────────────────────────────── */}
      <div className="card panel">
        <div className="between sec-head">
          <h2 className="sec-title">
            <Search size={15} aria-hidden="true" />
            What customers asked for that you don&apos;t sell
          </h2>
          {(demand?.totalRequests ?? 0) > 0 && (
            <span className="trend-total">
              {demand?.totalRequests} missed
            </span>
          )}
        </div>
        <p className="t-muted sec-sub">
          Ranked by how many different people asked. Five people asking once
          each is a stronger signal than one person asking five times.
        </p>

        {demandChart.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <CheckCircle size={18} />
            </span>
            <p className="empty-head">Nothing missed</p>
            <p className="t-muted empty-sub">Every request in this period found a product in your catalogue.</p>
          </div>
        ) : (
          <>
            <div className="chart" aria-hidden="true">
              <ResponsiveContainer width="100%" height={Math.max(150, demandChart.length * 46)}>
                <BarChart
                  data={demandChart}
                  layout="vertical"
                  margin={{ top: 4, right: 20, bottom: 4, left: 0 }}
                >
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--ink-2)', fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-3)' }}
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      borderRadius: 10,
                      fontSize: '0.8125rem',
                    }}
                    formatter={(v) => [`${String(v)} asked`, '']}
                  />
                  <Bar dataKey="customers" radius={[0, 6, 6, 0]} barSize={18}>
                    <LabelList
                      dataKey="customers"
                      position="right"
                      style={{ fill: 'var(--ink-2)', fontSize: 12, fontWeight: 600 }}
                    />
                    {demandChart.map((_, i) => (
                      <Cell key={i} fill="var(--brand)" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="t-muted foot">
              Consider stocking the items at the top — customers are already
              asking for them.
            </p>
          </>
        )}
      </div>

      </div>

      {/* ── Problems, only when there are any ──────────────────── */}
      {data.recentFailures.length > 0 && (
        <div className="card panel">
          <h2 className="sec-title">Recent problems</h2>
          <p className="t-muted sec-sub">
            Messages the assistant could not handle. Nothing was lost — these
            just need handling the usual way.
          </p>

          <ul className="problems">
            {[
              ...new Map(
                data.recentFailures.map((f) => [plainProblem(f.errorMessage), f]),
              ).entries(),
            ]
              .slice(0, 4)
              .map(([text, f]) => (
                <li key={text} className="problem">
                  <AlertCircle size={14} className="problem-icon" aria-hidden="true" />
                  <div>
                    <p className="problem-text">{text}</p>
                    <time className="t-muted problem-time">
                      {new Date(f.at).toLocaleString()}
                    </time>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}

      <style jsx>{`
        .head-actions {
          gap: 8px;
          flex-wrap: wrap;
        }

        /* .card carries no padding of its own, so every section needs it.
           Without this the text sits flush against the border and the card
           reads as an empty box with something floating in the corner. */
        .panel {
          padding: 20px 22px;
        }

        /* One segmented control rather than three loose buttons. */
        .seg {
          gap: 2px;
          padding: 3px;
          background: var(--surface-3);
          border-radius: var(--r-md);
        }
        .seg-btn {
          padding: 8px 13px;
          border: none;
          background: transparent;
          border-radius: calc(var(--r-md) - 3px);
          font-family: inherit;
          font-size: 0.8125rem;
          font-weight: 550;
          color: var(--ink-2);
          cursor: pointer;
          white-space: nowrap;
        }
        .seg-btn-on {
          background: var(--surface-1);
          color: var(--ink);
          box-shadow: var(--shadow-sm);
        }

        .notice {
          gap: 11px;
          align-items: flex-start;
          padding: 14px 16px;
          background: var(--warning-soft);
          border-color: var(--warning);
        }
        .notice-icon {
          color: var(--warning);
          flex-shrink: 0;
          margin-top: 2px;
        }
        .notice-text {
          font-size: 0.8125rem;
          line-height: 1.5;
          max-width: 70ch;
        }

        .status {
          gap: 12px;
          align-items: flex-start;
          padding: 14px 17px;
        }
        .status-icon {
          flex-shrink: 0;
          margin-top: 1px;
        }
        .status-title {
          font-size: 0.9375rem;
        }
        .status-text {
          font-size: 0.8125rem;
          margin-top: 2px;
          max-width: 62ch;
        }

        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px;
        }

        /* Wide screens get two columns. A single stacked column of full-width
           cards reads as a list and leaves half the screen empty. */
        .split {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        @media (min-width: 1100px) {
          .split {
            grid-template-columns: 1fr 1fr;
            align-items: start;
          }
        }

        .sec-head {
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .sec-head .sec-sub {
          margin-bottom: 0;
        }
        .sec-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .sec-sub {
          font-size: 0.8125rem;
          line-height: 1.5;
          margin-bottom: 16px;
          max-width: 62ch;
        }
        .trend-total {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--ink-2);
          background: var(--surface-3);
          padding: 5px 10px;
          border-radius: var(--r-full);
          white-space: nowrap;
        }

        /* A designed empty state: centred, with an icon and a next step.
           Grey text left-aligned under a heading looks like a rendering
           failure rather than a deliberate state. */
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 6px;
          padding: 26px 12px;
          min-height: 132px;
          background: var(--surface-1);
          border: 1px dashed var(--line);
          border-radius: var(--r-md);
        }
        .empty-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: var(--r-full);
          background: var(--surface-3);
          color: var(--ink-3);
          margin-bottom: 2px;
        }
        .empty-head {
          font-size: 0.9375rem;
          font-weight: 600;
        }
        .empty-sub {
          font-size: 0.8125rem;
          line-height: 1.5;
          max-width: 42ch;
        }

        .donut-wrap {
          position: relative;
          margin-bottom: 16px;
        }
        .donut-centre {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .donut-value {
          font-size: 1.5rem;
          font-weight: 650;
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }
        .donut-label {
          font-size: 0.6875rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-3);
        }

        .legend {
          list-style: none;
          display: grid;
          gap: 13px;
          margin: 0;
          padding: 0;
        }
        .legend-item {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .swatch {
          width: 10px;
          height: 10px;
          border-radius: 3px;
          margin-top: 5px;
          flex-shrink: 0;
        }
        .legend-copy {
          min-width: 0;
        }
        .legend-head {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .legend-count {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          color: var(--ink-2);
        }
        .legend-share {
          font-weight: 500;
          color: var(--ink-3);
        }
        .legend-meaning {
          font-size: 0.75rem;
          line-height: 1.45;
          margin-top: 2px;
        }

        .chart {
          margin-left: -10px;
        }
        .foot {
          font-size: 0.75rem;
          margin-top: 12px;
        }

        .problems {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 12px;
        }
        .problem {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .problem-icon {
          color: var(--warning);
          flex-shrink: 0;
          margin-top: 2px;
        }
        .problem-text {
          font-size: 0.875rem;
          line-height: 1.45;
        }
        .problem-time {
          font-size: 0.75rem;
        }

        @media (max-width: 640px) {
          .panel {
            padding: 17px 16px;
          }
          .chart {
            margin-left: -16px;
          }
          .empty-state {
            min-height: 118px;
            padding: 22px 10px;
          }
        }
      `}</style>
    </div>
  );
}
