'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  RefreshCw,
  Package,
  Inbox,
  Check,
  Sparkles,
  X,
  AlertCircle,
} from '../../../components/icons';
import ConfirmModal from '../../../components/ConfirmModal';
import { ordersApi, productsApi } from '../../../lib/api';
import { subscribeToSse } from '../../../lib/sse';

interface DraftOrder {
  id: string;
  customerMessage: string;
  overallConfidence: number;
  status: string;
  createdAt: string;
  /**
   * Set when this draft repeats a recent one from the same customer
   * (BUSINESS_RULES §18). Flagged for review, never auto-blocked — approving
   * both would create two real WooCommerce orders.
   */
  duplicateOfId?: string | null;
  customer: {
    id: string;
    name: string;
    phone: string;
  };
  items: Array<{
    id: string;
    productQuery: string;
    matchedProductName: string | null;
    matchConfidence: number | null;
    quantity: number;
    unitPrice: string | null;
    product: {
      name: string;
      price: string;
    } | null;
  }>;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
  aiConfidenceScore: number | null;
  createdAt: string;
  customer: {
    name: string;
    phone: string;
  };
  items: Array<{
    quantity: number;
    subtotal: string;
    product: {
      name: string;
    };
  }>;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Orders' },
  { value: 'PENDING_AI', label: 'Pending AI' },
  { value: 'WAITING_APPROVAL', label: 'Waiting Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SYNCED', label: 'Synced' },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    PENDING_AI: { cls: 'badge-pending', label: 'Pending AI' },
    WAITING_APPROVAL: { cls: 'badge-pending', label: 'Waiting Approval' },
    PENDING: { cls: 'badge-pending', label: 'Pending' },
    APPROVED: { cls: 'badge-approved', label: 'Approved' },
    REJECTED: { cls: 'badge-rejected', label: 'Rejected' },
    SYNCED: { cls: 'badge-info', label: 'Synced' },
    FAILED: { cls: 'badge-rejected', label: 'Failed' },
    REVIEWED: { cls: 'badge-neutral', label: 'Reviewed' },
  };
  const s = map[status] || { cls: 'badge-neutral', label: status };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export default function OrdersPage() {
  const [tab, setTab] = useState<'drafts' | 'orders'>('drafts');
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await ordersApi.getDrafts();
      setDrafts(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch drafts:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: { status?: string; page: number; limit: number } = { page, limit: 15 };
      if (statusFilter) params.status = statusFilter;
      const res = await ordersApi.getOrders(params);
      setOrders(res.data.data?.orders || []);
      setTotalPages(res.data.data?.totalPages || 1);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    if (tab === 'drafts') {
      fetchDrafts();
    } else {
      fetchOrders();
    }
  }, [tab, fetchDrafts, fetchOrders]);

  // Real-time updates subscription using Server-Sent Events (SSE).
  // Uses a fetch-based client (see lib/sse.ts) so the JWT travels in the
  // Authorization header — never in the URL — per SECURITY.md / API_GUIDELINES.md.
  useEffect(() => {
    const token = localStorage.getItem('commercepilot_token');
    if (!token) return;

    const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

    const unsubscribe = subscribeToSse(
      `${apiBaseUrl}/orders/events`,
      token,
      (data) => {
        try {
          const payload = JSON.parse(data);
          if (payload.type === 'DRAFT_CREATED') {
            setDrafts((prev) => {
              if (prev.some((d) => d.id === payload.payload.id)) return prev;
              return [payload.payload, ...prev];
            });
          }
        } catch (err) {
          console.error('Failed to parse SSE message:', err);
        }
      },
      (err) => {
        console.error('SSE connection error:', err);
      },
    );

    return unsubscribe;
  }, []);

  const handleApprove = async (draftId: string) => {
    setActionLoading(draftId);
    try {
      await ordersApi.approveDraft(draftId);
      await fetchDrafts();
    } catch (err) {
      console.error('Failed to approve:', err);
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
      await fetchDrafts();
    } catch (err) {
      console.error('Failed to reject:', err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="page animate-fade-in">
      {/* Header */}
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <div className="sub">Review AI-extracted orders and manage your order pipeline</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => tab === 'drafts' ? fetchDrafts() : fetchOrders()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="row" style={{ gap: 4, marginBottom: 20, background: 'var(--surface-1)', padding: 4, borderRadius: 'var(--r-md)', width: 'fit-content', border: '1px solid var(--line)' }}>
        {(['drafts', 'orders'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className="row"
            style={{
              gap: 7, padding: '7px 16px', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
              fontSize: '0.8125rem', fontWeight: 600,
              background: tab === t ? 'var(--surface-3)' : 'transparent',
              color: tab === t ? 'var(--ink)' : 'var(--ink-3)',
              transition: 'all var(--dur-1) var(--ease)',
            }}
          >
            {t === 'drafts' ? <Inbox size={15} /> : <Package size={15} />}
            {t === 'drafts' ? 'Pending Drafts' : 'All Orders'}
          </button>
        ))}
      </div>

      {/* Filter (orders tab only) */}
      {tab === 'orders' && (
        <div className="row" style={{ gap: 10, marginBottom: 18 }}>
          <Filter size={14} color="var(--ink-3)" />
          <select className="select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ width: 200 }}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '56px 0' }}>
          <Loader2 size={26} color="var(--brand)" style={{ animation: 'spin 1s linear infinite', margin: '0 auto' }} />
          <p className="t-muted" style={{ marginTop: 12 }}>Loading orders...</p>
        </div>
      ) : tab === 'drafts' ? (
        /* ── Draft Orders ───────────────────────────── */
        drafts.length === 0 ? (
          <div className="glass-card" style={{ padding: '56px 24px', textAlign: 'center' }}>
            <span className="row" style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--brand-soft)', color: 'var(--brand)', justifyContent: 'center', margin: '0 auto 14px' }}>
              <CheckCircle size={24} />
            </span>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4 }}>All caught up!</h3>
            <p className="t-muted">No pending draft orders. Send a test message from the WhatsApp Simulator.</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {drafts.map((draft) => (
              <div key={draft.id} className="glass-card" style={{ padding: '18px 22px', cursor: 'pointer' }} onClick={() => setSelectedDraftId(draft.id)}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 15 }}>
                  <span className="row" style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--surface-3)', color: 'var(--ink-2)', justifyContent: 'center', fontWeight: 700, fontSize: '0.9375rem', flexShrink: 0 }}>
                    {draft.customer?.name?.[0] || '?'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 9, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{draft.customer?.name || 'Unknown'}</span>
                      <StatusBadge status={draft.status} />
                      <span className={`badge ${draft.overallConfidence >= 0.9 ? 'badge-approved' : draft.overallConfidence >= 0.75 ? 'badge-pending' : 'badge-rejected'}`}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
                        {(draft.overallConfidence * 100).toFixed(0)}% confidence
                      </span>
                      {draft.duplicateOfId && (
                        <span
                          className="badge badge-pending"
                          title="This customer sent a very similar order minutes ago. Check before approving — approving both creates two orders."
                        >
                          <AlertCircle size={11} />
                          Possible duplicate
                        </span>
                      )}
                    </div>
                    <p className="t-muted" style={{ fontStyle: 'italic', marginBottom: 10, fontSize: '0.8125rem' }}>&quot;{draft.customerMessage}&quot;</p>
                    <div className="stack" style={{ gap: 6, marginBottom: 14 }}>
                      {draft.items.map((item) => (
                        <div key={item.id} className="row" style={{ gap: 10, padding: '8px 12px', background: 'var(--surface-1)', borderRadius: 8 }}>
                          <Package size={14} color="var(--brand)" />
                          <span style={{ fontSize: '0.8125rem', flex: 1 }}>{item.quantity}× {item.matchedProductName || item.productQuery}</span>
                          {item.unitPrice && <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--brand)' }}>${Number(item.unitPrice) * item.quantity}</span>}
                        </div>
                      ))}
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); handleApprove(draft.id); }} disabled={actionLoading === draft.id}>
                        {actionLoading === draft.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Approve'}
                      </button>
                      <button className="btn btn-ghost btn-sm reject-btn" onClick={(e) => { e.stopPropagation(); setRejectingId(draft.id); }} disabled={actionLoading === draft.id}>
                        Reject
                      </button>
                    </div>
                  </div>
                  <span className="t-muted" style={{ fontSize: '0.6875rem', flexShrink: 0 }}>{new Date(draft.createdAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* ── All Orders Table ──────────────────────── */
        orders.length === 0 ? (
          <div className="glass-card" style={{ padding: '56px 24px', textAlign: 'center' }}>
            <ShoppingCart size={36} color="var(--ink-3)" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4 }}>No orders yet</h3>
            <p className="t-muted">Orders will appear here after approving AI-drafted orders.</p>
          </div>
        ) : (
          <>
            <div className="glass-card table-scroll" style={{ overflow: 'hidden' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Confidence</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} style={{ cursor: 'pointer' }}>
                      <td data-label="Order" style={{ fontWeight: 600, color: 'var(--info)' }}>{order.orderNumber}</td>
                      <td data-label="Customer">
                        <div style={{ fontWeight: 500 }}>{order.customer?.name}</div>
                        <div className="t-muted" style={{ fontSize: '0.75rem' }}>{order.customer?.phone}</div>
                      </td>
                      <td data-label="Items">{order.items?.length || 0} items</td>
                      <td data-label="Total" className="metric">${Number(order.totalAmount).toFixed(2)}</td>
                      <td data-label="Status"><StatusBadge status={order.status} /></td>
                      <td data-label="Confidence">{order.aiConfidenceScore != null ? `${(order.aiConfidenceScore * 100).toFixed(0)}%` : '—'}</td>
                      <td data-label="Date" className="t-muted" style={{ fontSize: '0.75rem' }}>{new Date(order.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 18 }}>
              <button className="btn btn-ghost btn-icon" style={{ width: 34, height: 34 }} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft size={14} />
              </button>
              <span className="t-muted" style={{ padding: '0 8px', display: 'flex', alignItems: 'center' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-ghost btn-icon" style={{ width: 34, height: 34 }} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight size={14} />
              </button>
            </div>
          </>
        )
      )}

      {/* Slide-in Order Details Panel */}
      {selectedDraftId && (
        <OrderDetailPanel
          id={selectedDraftId}
          onClose={() => {
            setSelectedDraftId(null);
            fetchDrafts();
          }}
        />
      )}

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

      <style>{`.reject-btn:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }`}</style>
    </div>
  );
}

/* ── Slide-in Order Details & Correction Component ── */
interface OrderDetailPanelProps {
  id: string;
  onClose: () => void;
}

function OrderDetailPanel({ id, onClose }: OrderDetailPanelProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ draft: any; aiLogs: any[]; conversationMessages: any[] } | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editedItems, setEditedItems] = useState<any[]>([]);
  const [editedAddress, setEditedAddress] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, prodRes] = await Promise.all([
        ordersApi.getDraftById(id),
        productsApi.getProducts({ limit: 100 }),
      ]);
      setData(res.data.data);
      setProducts(prodRes.data.data?.products || []);

      const draft = res.data.data.draft;
      const structured = draft.structuredData || {};

      const itemsList = draft.items.map((i: any) => ({
        productQuery: i.productQuery,
        productId: i.productId,
        matchedProductName: i.matchedProductName || i.product?.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      }));
      setEditedItems(itemsList);
      setEditedAddress(structured.delivery_info?.address || draft.deliveryAddress || '');
    } catch (err) {
      console.error('Failed to load draft detail:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', zIndex: 999 }} onClick={onClose} />
        <div className="order-panel row" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, background: 'var(--surface-1)', borderLeft: '1px solid var(--line)', zIndex: 1000, justifyContent: 'center' }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} color="var(--brand)" />
        </div>
      </>
    );
  }

  if (!data) return null;

  const { draft, aiLogs, conversationMessages } = data;
  const shortId = draft.id.substring(0, 8);

  const handleAddField = () => {
    setEditedItems([...editedItems, { productQuery: '', productId: null, matchedProductName: '', quantity: 1, unitPrice: null }]);
  };

  const handleRemoveField = (idx: number) => {
    setEditedItems(editedItems.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: string, value: any) => {
    const updated = [...editedItems];
    if (field === 'productId') {
      const prod = products.find((p) => p.id === value);
      updated[idx].productId = value || null;
      updated[idx].matchedProductName = prod ? prod.name : '';
      updated[idx].unitPrice = prod ? prod.price : null;
    } else {
      updated[idx][field] = value;
    }
    setEditedItems(updated);
  };

  const hasEdits = () => {
    const origStructured = draft.structuredData || {};
    const origAddress = origStructured.delivery_info?.address || draft.deliveryAddress || '';
    if (editedAddress !== origAddress) return true;

    if (editedItems.length !== draft.items.length) return true;
    for (let i = 0; i < editedItems.length; i++) {
      const origItem = draft.items[i];
      const curItem = editedItems[i];
      if (curItem.productId !== origItem.productId) return true;
      if (Number(curItem.quantity) !== Number(origItem.quantity)) return true;
    }
    return false;
  };

  const handleSaveAndApprove = async () => {
    setActionLoading(true);
    try {
      if (hasEdits() || isEditing) {
        const correctedData = {
          items: editedItems.map((item) => ({
            product_query: item.productQuery || item.matchedProductName,
            matched_product_id: item.productId,
            matched_product_name: item.matchedProductName,
            match_confidence: 1.0,
            quantity: Number(item.quantity),
            unitPrice: item.unitPrice,
            selected_attributes: {},
          })),
          delivery_info: {
            address: editedAddress,
          },
          missing_fields: [],
        };
        await ordersApi.correctDraft(id, correctedData);
      }
      await ordersApi.approveDraft(id);
      onClose();
    } catch (err) {
      console.error('Failed to correct and approve draft:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await ordersApi.rejectDraft(id, rejectReason);
      onClose();
    } catch (err) {
      console.error('Failed to reject draft:', err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', zIndex: 999 }} onClick={onClose} />
      <div className="order-panel stack" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, background: 'var(--surface-1)', borderLeft: '1px solid var(--line)', zIndex: 1000, animation: 'panelSlideIn var(--dur-3) var(--ease)' }}>
        <style>{`
          @keyframes panelSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
          .order-panel { width: 550px; max-width: 100vw; }
          @media (max-width: 640px) { .order-panel { width: 100vw; } }
        `}</style>

        {/* Header */}
        <div className="between" style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: '0.9375rem', fontWeight: 700 }}>Draft CP-{shortId}</span>
              <StatusBadge status={draft.status} />
            </div>
            <div className="t-muted">{draft.customer?.name} · {draft.customer?.phone}</div>
          </div>
          <button className="btn btn-ghost btn-icon" style={{ width: 32, height: 32 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
          {/* Chat Transcript */}
          <div style={{ marginBottom: 22 }}>
            <h4 className="t-eyebrow" style={{ marginBottom: 10 }}>Chat Transcript</h4>
            <div className="stack" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 14, maxHeight: 200, overflowY: 'auto', gap: 10 }}>
              {conversationMessages.length === 0 ? (
                <div className="t-muted" style={{ textAlign: 'center', padding: 10 }}>No message history available.</div>
              ) : (
                conversationMessages.map((m) => {
                  const isInbound = m.direction === 'INBOUND';
                  return (
                    <div key={m.id} style={{ alignSelf: isInbound ? 'flex-start' : 'flex-end', maxWidth: '85%' }}>
                      <div style={{ background: isInbound ? 'var(--surface-3)' : 'var(--brand-soft)', border: '1px solid ' + (isInbound ? 'var(--line)' : 'var(--brand-line)'), padding: '8px 12px', borderRadius: 12, fontSize: '0.8125rem' }}>
                        {m.messageText}
                      </div>
                      <div className="t-muted" style={{ fontSize: '0.6875rem', marginTop: 3, textAlign: isInbound ? 'left' : 'right' }}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Items Editing / Viewing */}
          <div style={{ marginBottom: 22 }}>
            <div className="between" style={{ marginBottom: 11 }}>
              <h4 className="t-eyebrow">Order Contents</h4>
              {!isEditing && <button className="btn btn-ghost btn-sm" onClick={() => setIsEditing(true)}>Edit Details</button>}
            </div>

            {isEditing ? (
              <div className="stack" style={{ gap: 10 }}>
                {editedItems.map((item, idx) => (
                  <div key={idx} className="row" style={{ gap: 8, padding: 9, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
                    <select className="select" value={item.productId || ''} onChange={(e) => handleItemChange(idx, 'productId', e.target.value)} style={{ flex: 1, fontSize: '0.8125rem', padding: '7px 30px 7px 10px' }}>
                      <option value="">-- Match Product --</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} (${Number(p.price).toFixed(2)})</option>
                      ))}
                    </select>
                    <input type="number" className="input" value={item.quantity} min="1" onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))} style={{ width: 56, fontSize: '0.8125rem', padding: 7, textAlign: 'center' }} />
                    <button className="btn btn-ghost btn-icon" style={{ width: 32, height: 32, color: 'var(--danger)' }} onClick={() => handleRemoveField(idx)} aria-label="Remove item"><X size={15} /></button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={handleAddField} style={{ border: '1px dashed var(--line-strong)' }}>+ Add Product</button>
                <label className="stack" style={{ gap: 6, marginTop: 6 }}>
                  Delivery address
                  <input type="text" className="input" value={editedAddress} onChange={(e) => setEditedAddress(e.target.value)} style={{ fontSize: '0.8125rem' }} />
                </label>
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {editedItems.map((item, idx) => (
                  <div key={idx} className="row" style={{ gap: 10, padding: '10px 13px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
                    <Package size={16} color="var(--info)" />
                    <span style={{ fontSize: '0.8125rem', flex: 1 }}>{item.quantity}× {item.matchedProductName || item.productQuery || 'Unmatched Product'}</span>
                    {item.unitPrice && <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--brand)' }}>${Number(item.unitPrice) * item.quantity}</span>}
                  </div>
                ))}
                <div style={{ padding: '10px 13px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)', fontSize: '0.8125rem' }}>
                  <strong>Address: </strong>{editedAddress || <span style={{ fontStyle: 'italic', color: 'var(--ink-3)' }}>None provided</span>}
                </div>
              </div>
            )}
          </div>

          {/* AI Logs & Score */}
          <div>
            <h4 className="t-eyebrow" style={{ marginBottom: 10 }}>AI Pipeline Log</h4>
            <div className="stack" style={{ gap: 10 }}>
              <div className="between" style={{ padding: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8 }}>
                <span style={{ fontSize: '0.8125rem' }}>AI Composite Confidence</span>
                <span className="metric" style={{ fontSize: '0.875rem', color: draft.overallConfidence >= 0.8 ? 'var(--brand)' : 'var(--warning)' }}>{(draft.overallConfidence * 100).toFixed(1)}%</span>
              </div>
              <div className="stack" style={{ maxHeight: 180, overflowY: 'auto', gap: 8 }}>
                {aiLogs.map((log) => (
                  <div key={log.id} style={{ padding: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: '0.75rem' }}>
                    <div className="between" style={{ fontWeight: 600, marginBottom: 4 }}>
                      <span>Stage: {log.stage}</span>
                      <span className="t-muted">{log.processingTimeMs}ms</span>
                    </div>
                    {log.stage === 'CONFIDENCE_SCORING' && log.outputData?.explanation && (
                      <div className="t-muted" style={{ fontSize: '0.6875rem', whiteSpace: 'pre-wrap', marginTop: 4 }}>
                        {log.outputData.explanation.join('\n')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="stack" style={{ padding: '18px 22px', borderTop: '1px solid var(--line)', gap: 10, flexShrink: 0 }}>
          {showRejectInput ? (
            <div className="row" style={{ gap: 8 }}>
              <input type="text" className="input" placeholder="Reason for rejection..." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleReject()} autoFocus style={{ fontSize: '0.8125rem', flex: 1 }} />
              <button className="btn btn-danger" onClick={handleReject} disabled={actionLoading || !rejectReason.trim()} style={{ flexShrink: 0 }}>Submit</button>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowRejectInput(false)} style={{ flexShrink: 0 }} aria-label="Cancel"><X size={16} /></button>
            </div>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              <button
                onClick={handleSaveAndApprove}
                disabled={actionLoading}
                className="btn"
                style={{ flex: 1, background: hasEdits() ? 'var(--warning)' : 'var(--brand)', color: hasEdits() ? '#1a1917' : 'var(--ink-on-brand)', fontWeight: 600, height: 42 }}
              >
                {actionLoading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : hasEdits() ? <><Sparkles size={15} /> Edit + Approve</> : <><Check size={15} /> Approve Draft</>}
              </button>
              <button className="btn btn-danger btn-icon" onClick={() => setShowRejectInput(true)} disabled={actionLoading} style={{ width: 42, height: 42 }} aria-label="Reject"><XCircle size={16} /></button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
