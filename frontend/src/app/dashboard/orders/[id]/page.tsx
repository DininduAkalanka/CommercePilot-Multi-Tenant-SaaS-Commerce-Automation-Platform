'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Bot, User, Loader2, Clock, Package, Edit2, Activity } from '../../../../components/icons';
import ConfirmModal from '../../../../components/ConfirmModal';
import { ordersApi } from '../../../../lib/api';

interface DraftDetail {
  draft: {
    id: string;
    customerMessage: string;
    structuredData: any;
    intentConfidence: number;
    productMatchConfidence: number;
    completenessScore: number;
    overallConfidence: number;
    status: string;
    createdAt: string;
    customer: { name: string; phone: string };
    items: Array<{
      id: string;
      productQuery: string;
      matchedProductName: string | null;
      matchConfidence: number | null;
      quantity: number;
      unitPrice: string | null;
      selectedAttributes: any;
      product: { name: string; price: string } | null;
    }>;
  };
  aiLogs: Array<{
    id: string;
    stage: string;
    processingTimeMs: number;
    overallConfidence: number | null;
    success: boolean;
    createdAt: string;
  }>;
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<DraftDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await ordersApi.getDraftById(id);
      setData(res.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApprove = async () => {
    if (!data) return;
    setActionLoading(true);
    try {
      await ordersApi.approveDraft(id);
      router.push('/dashboard/orders');
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const confirmReject = async (reason?: string) => {
    setActionLoading(true);
    try {
      await ordersApi.rejectDraft(id, reason || 'Rejected by owner');
      router.push('/dashboard/orders');
    } catch (err) {
      console.error(err);
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: '100px 0' }}>
        <Loader2 size={28} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (!data?.draft) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <p className="t-muted">Order not found.</p>
        <button className="btn btn-ghost btn-sm" onClick={() => router.back()} style={{ marginTop: 16 }}>Go back</button>
      </div>
    );
  }

  const { draft, aiLogs } = data;

  return (
    <div className="page animate-fade-in">
      {/* Header */}
      <div className="row" style={{ gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-icon" onClick={() => router.back()} style={{ borderRadius: '50%' }} aria-label="Go back">
          <ChevronLeft size={19} />
        </button>
        <div>
          <h1 className="row" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 500, gap: 11 }}>
            Draft Order Review
            <span className="badge badge-pending">{draft.status.replace('_', ' ')}</span>
          </h1>
          <p className="t-muted" style={{ marginTop: 4 }}>Customer: {draft.customer.name} ({draft.customer.phone})</p>
        </div>
        <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
          {draft.status === 'PENDING' && (
            <>
              <button className="btn btn-ghost btn-sm" disabled={actionLoading}>
                <Edit2 size={14} /> Edit
              </button>
              <button className="btn btn-ghost btn-sm reject-btn" onClick={() => setRejectOpen(true)} disabled={actionLoading}>
                Reject
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleApprove} disabled={actionLoading}>
                {actionLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Approve'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="detail-grid">
        {/* Main */}
        <div className="stack" style={{ gap: 18 }}>
          <div className="glass-card" style={{ padding: 22 }}>
            <h2 className="row" style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: 15, gap: 8 }}>
              <User size={15} color="var(--violet)" /> Customer Message
            </h2>
            <div style={{ padding: 15, background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              &quot;{draft.customerMessage}&quot;
            </div>
            <div className="t-muted" style={{ fontSize: '0.6875rem', marginTop: 8, textAlign: 'right' }}>
              Received at {new Date(draft.createdAt).toLocaleString()}
            </div>
          </div>

          <div className="glass-card" style={{ padding: 22 }}>
            <h2 className="row" style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: 15, gap: 8 }}>
              <Bot size={15} color="var(--info)" /> AI Extracted Items
            </h2>

            <div className="table-scroll" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Requested</th><th>Matched product</th><th>Qty</th><th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.items.map(item => (
                    <tr key={item.id}>
                      <td data-label="Requested" className="t-muted">&quot;{item.productQuery}&quot;</td>
                      <td data-label="Matched">
                        <div className="row" style={{ gap: 8 }}>
                          <Package size={14} color="var(--info)" />
                          {item.matchedProductName || <span style={{ color: 'var(--danger)' }}>No match found</span>}
                        </div>
                        {item.selectedAttributes && Object.keys(item.selectedAttributes).length > 0 && (
                          <div className="t-muted" style={{ fontSize: '0.6875rem', marginTop: 4 }}>{JSON.stringify(item.selectedAttributes)}</div>
                        )}
                      </td>
                      <td data-label="Qty" className="metric">{item.quantity}</td>
                      <td data-label="Confidence">
                        {item.matchConfidence ? (
                          <span className={`badge ${item.matchConfidence >= 0.8 ? 'badge-approved' : 'badge-pending'}`}>{(item.matchConfidence * 100).toFixed(0)}%</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {draft.structuredData?.delivery_info && Object.keys(draft.structuredData.delivery_info).length > 0 && (
              <div style={{ marginTop: 18, padding: 15, background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
                <h3 className="t-eyebrow" style={{ marginBottom: 8 }}>Delivery Info</h3>
                <pre style={{ fontSize: '0.8125rem', margin: 0, fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(draft.structuredData.delivery_info, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="stack" style={{ gap: 18 }}>
          <div className="glass-card" style={{ padding: 22 }}>
            <h3 className="t-eyebrow" style={{ marginBottom: 15 }}>AI Confidence</h3>
            <div className="row" style={{ gap: 15, paddingBottom: 15, borderBottom: '1px solid var(--line)', marginBottom: 15 }}>
              <div className="metric" style={{ fontSize: '2rem', color: draft.overallConfidence >= 0.85 ? 'var(--brand)' : 'var(--warning)' }}>
                {(draft.overallConfidence * 100).toFixed(0)}%
              </div>
              <div className="t-muted" style={{ flex: 1, fontSize: '0.75rem' }}>
                {draft.overallConfidence >= 0.85 ? 'High confidence. Safe to approve.' : 'Requires human review.'}
              </div>
            </div>
            <div className="stack" style={{ gap: 12 }}>
              {[
                { label: 'Intent Detection', score: draft.intentConfidence },
                { label: 'Product Match', score: draft.productMatchConfidence },
                { label: 'Completeness', score: draft.completenessScore },
              ].map(item => (
                <div key={item.label}>
                  <div className="between" style={{ marginBottom: 6, fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--ink-2)' }}>{item.label}</span>
                    <span style={{ fontWeight: 600 }}>{(item.score * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--surface-4)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${item.score * 100}%`, background: item.score >= 0.8 ? 'var(--brand)' : 'var(--warning)', borderRadius: 'var(--r-full)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card" style={{ padding: 22 }}>
            <h3 className="row t-eyebrow" style={{ marginBottom: 15, gap: 6 }}>
              <Activity size={13} /> Processing Pipeline
            </h3>
            <div className="stack" style={{ gap: 15 }}>
              {aiLogs.map((log, i) => (
                <div key={log.id} className="row" style={{ gap: 11, position: 'relative', alignItems: 'flex-start' }}>
                  {i !== aiLogs.length - 1 && (
                    <div style={{ position: 'absolute', left: 8, top: 22, bottom: -15, width: 2, background: 'var(--line)' }} />
                  )}
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: log.success ? 'var(--brand-soft)' : 'var(--danger-soft)', border: `2px solid ${log.success ? 'var(--brand)' : 'var(--danger)'}`, flexShrink: 0, marginTop: 2, zIndex: 1 }} />
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{log.stage.replace(/_/g, ' ')}</div>
                    <div className="t-muted row" style={{ fontSize: '0.6875rem', gap: 4 }}>
                      <Clock size={10} /> {log.processingTimeMs}ms
                    </div>
                  </div>
                </div>
              ))}
              {aiLogs.length === 0 && <div className="t-muted">No logs available for this draft.</div>}
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={rejectOpen}
        title="Reject this draft order?"
        description="The customer's draft will be dismissed and won't be synced. Let your team know why."
        confirmLabel="Reject order"
        cancelLabel="Keep draft"
        tone="danger"
        loading={actionLoading}
        requireReason
        reasonLabel="Reason for rejection"
        reasonPlaceholder="e.g. Out of stock, duplicate order, unclear request…"
        reasonRequired
        onConfirm={confirmReject}
        onCancel={() => setRejectOpen(false)}
      />

      <style>{`
        .detail-grid { display: grid; grid-template-columns: 1fr 340px; gap: 18px; }
        @media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } }
        .reject-btn:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }
      `}</style>
    </div>
  );
}
