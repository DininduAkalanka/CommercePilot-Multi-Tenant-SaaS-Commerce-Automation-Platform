'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ShoppingCart,
  Clock,
  CheckCircle,
  Bot,
  ChevronRight,
  Loader2,
  RefreshCw,
  Package,
  Wallet,
  Activity,
} from '../../components/icons';
import ConfirmModal from '../../components/ConfirmModal';
import { ordersApi } from '../../lib/api';

function ConfidenceBadge({ score }: { score: number }) {
  const cls = score >= 0.9 ? 'badge-approved' : score >= 0.75 ? 'badge-pending' : 'badge-rejected';
  return (
    <span className={`badge ${cls}`}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
      {(score * 100).toFixed(0)}% confidence
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ElementType;
}) {
  return (
    <div className="card glass-card" style={{ padding: '18px 20px' }}>
      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <span className="row" style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--brand-soft)', color: 'var(--brand)', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={17} />
        </span>
        <span className="t-eyebrow" style={{ paddingTop: 1 }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{value}</div>
      <div className="t-muted" style={{ marginTop: 4 }}>{sub}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, analyticsRes, draftsRes, activityRes] = await Promise.all([
        ordersApi.getStats(),
        ordersApi.getAnalytics(),
        ordersApi.getDrafts(),
        ordersApi.getRecentActivity().catch(() => ({ data: { data: [] } })),
      ]);
      setStats(statsRes.data.data);
      setAnalytics(analyticsRes.data.data);
      setDrafts(draftsRes.data.data?.slice(0, 5) || []);
      setActivity(activityRes.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await ordersApi.approveDraft(id);
      fetchDashboardData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const confirmReject = async (reason?: string) => {
    if (!rejectingId) return;
    setActionLoading(rejectingId);
    try {
      await ordersApi.rejectDraft(rejectingId, reason || 'Rejected by owner');
      setRejectingId(null);
      fetchDashboardData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: '100px 0' }}>
        <Loader2 size={30} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // Real AI metrics from /orders/analytics — 0% on a fresh account, real values
  // once orders are processed. Never hardcoded.
  const aiEngine = [
    { label: 'Avg AI Confidence', score: Math.round(analytics?.aiConfidenceAvg ?? 0) },
    { label: 'Approval Rate', score: Math.round(analytics?.approvalRate ?? 0) },
  ];

  return (
    <div className="page animate-fade-in">
      {/* Header */}
      <div className="page-head">
        <div>
          <h1>Operations Dashboard</h1>
          <div className="sub">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchDashboardData}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* KPIs */}
      <div className="grid-auto" style={{ marginBottom: 20 }}>
        <KpiCard label="Total Orders" value={stats?.totalOrders ?? 0} sub="All time" icon={ShoppingCart} />
        <KpiCard label="Pending Approval" value={stats?.pendingApproval ?? 0} sub="Requires your review" icon={Clock} />
        <KpiCard label="Approved Today" value={stats?.approvedToday ?? 0} sub="Auto + manual" icon={CheckCircle} />
        <KpiCard label="AI Accuracy" value={analytics ? `${analytics.aiConfidenceAvg}%` : '—'} sub="Avg. confidence" icon={Bot} />
        <KpiCard label="Total Revenue" value={`$${(analytics?.totalRevenue ?? 0).toFixed(2)}`} sub="All time" icon={Wallet} />
      </div>

      {/* Main grid */}
      <div className="dash-grid">
        {/* Pending drafts */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="between" style={{ padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <h2 className="t-h2">Pending AI Orders</h2>
              <div className="t-muted" style={{ marginTop: 2 }}>{drafts.length} awaiting your approval</div>
            </div>
            {drafts.length > 0 && <span className="pulse-green" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--brand)' }} />}
          </div>

          {drafts.length === 0 ? (
            <div className="stack" style={{ alignItems: 'center', padding: '56px 24px', gap: 12 }}>
              <span className="row" style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', justifyContent: 'center' }}>
                <CheckCircle size={24} />
              </span>
              <div style={{ fontWeight: 600 }}>All caught up</div>
              <div className="t-muted" style={{ textAlign: 'center' }}>No pending orders. Send a test message from the WhatsApp Simulator.</div>
            </div>
          ) : (
            drafts.map((draft, i) => (
              <div key={draft.id} style={{ padding: '16px 20px', borderBottom: i < drafts.length - 1 ? '1px solid var(--line)' : 'none' }}>
                <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                  <div className="row" style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-3)', color: 'var(--ink-2)', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
                    {draft.customer?.name?.[0] || '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row between" style={{ marginBottom: 4 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{draft.customer?.name || 'Unknown'}</span>
                        <ConfidenceBadge score={draft.overallConfidence} />
                      </div>
                      <span className="t-muted" style={{ fontSize: '0.6875rem' }}>{new Date(draft.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="t-muted" style={{ fontStyle: 'italic', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>&quot;{draft.customerMessage}&quot;</p>
                    {draft.items?.map((item: any) => (
                      <div key={item.id} className="row" style={{ gap: 10, padding: '8px 12px', background: 'var(--surface-1)', borderRadius: 8, marginBottom: 6 }}>
                        <Package size={14} color="var(--brand)" />
                        <span style={{ fontSize: '0.8125rem', flex: 1 }}>{item.quantity}× {item.matchedProductName || item.productQuery}</span>
                        {item.unitPrice && <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--brand)' }}>${Number(item.unitPrice) * item.quantity}</span>}
                      </div>
                    ))}
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => handleApprove(draft.id)} disabled={actionLoading === draft.id} style={{ flex: 1 }}>
                        {actionLoading === draft.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Approve'}
                      </button>
                      <Link href={`/dashboard/orders/${draft.id}`} className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>Review</Link>
                      <button className="btn btn-ghost btn-sm reject-btn" onClick={() => setRejectingId(draft.id)} disabled={actionLoading === draft.id}>Reject</button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}

          <Link href="/dashboard/orders" className="row" style={{ justifyContent: 'center', gap: 6, padding: 14, borderTop: '1px solid var(--line)', color: 'var(--brand)', fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none' }}>
            View all orders <ChevronRight size={14} />
          </Link>
        </div>

        {/* Right rail */}
        <div className="stack" style={{ gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h3 className="t-eyebrow" style={{ marginBottom: 16 }}>AI Performance</h3>
            <div className="stack" style={{ gap: 14 }}>
              {aiEngine.map((item) => (
                <div key={item.label}>
                  <div className="between" style={{ marginBottom: 7 }}>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--ink-2)' }}>{item.label}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{item.score}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--surface-4)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${item.score}%`, background: 'var(--brand)', borderRadius: 'var(--r-full)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 20, flex: 1 }}>
            <h3 className="t-eyebrow" style={{ marginBottom: 16 }}>Recent Activity</h3>
            <div className="stack" style={{ gap: 14 }}>
              {activity.length === 0 ? (
                <div className="t-muted">No recent activity.</div>
              ) : (
                activity.map((item) => (
                  <div key={item.id} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <span className="row" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-3)', color: 'var(--ink-2)', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                      <Activity size={13} />
                    </span>
                    <div>
                      <p style={{ fontSize: '0.8125rem', lineHeight: 1.4 }}>{item.text}</p>
                      <span className="t-muted" style={{ fontSize: '0.6875rem' }}>{new Date(item.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={rejectingId !== null}
        title="Reject this draft order?"
        description="The customer's draft will be dismissed and won't be synced. Let your team know why."
        confirmLabel="Reject order"
        cancelLabel="Keep draft"
        tone="danger"
        loading={actionLoading !== null && actionLoading === rejectingId}
        requireReason
        reasonLabel="Reason for rejection"
        reasonPlaceholder="e.g. Out of stock, duplicate order, unclear request…"
        reasonRequired
        onConfirm={confirmReject}
        onCancel={() => setRejectingId(null)}
      />

      <style>{`
        .dash-grid { display: grid; grid-template-columns: 1fr 340px; gap: 16px; }
        @media (max-width: 900px) { .dash-grid { grid-template-columns: 1fr; } }
        .reject-btn:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }
      `}</style>
    </div>
  );
}
