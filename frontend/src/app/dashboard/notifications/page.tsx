'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCircle, AlertCircle, MessageSquare, ShoppingCart, Bot, Loader2, RefreshCw, Filter } from '../../../components/icons';
import { notificationsApi } from '../../../lib/api';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  channel: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

function NotifIcon({ type }: { type: string }) {
  const iconStyle = { flexShrink: 0 };
  if (type.includes('ORDER')) return <ShoppingCart size={17} style={iconStyle} />;
  if (type.includes('AI')) return <Bot size={17} style={iconStyle} />;
  if (type.includes('CUSTOMER')) return <MessageSquare size={17} style={iconStyle} />;
  return <Bell size={17} style={iconStyle} />;
}

function ChannelBadge({ channel }: { channel: string }) {
  const cls: Record<string, string> = { EMAIL: 'badge-info', WHATSAPP: 'badge-approved', SYSTEM: 'badge-neutral' };
  return <span className={`badge ${cls[channel] ?? 'badge-neutral'}`}>{channel}</span>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'SENT' || status === 'DELIVERED') {
    return <span className="row" style={{ gap: 4, color: 'var(--brand)', fontSize: '0.75rem' }}><CheckCircle size={12} /> {status}</span>;
  }
  if (status === 'FAILED') {
    return <span className="row" style={{ gap: 4, color: 'var(--danger)', fontSize: '0.75rem' }}><AlertCircle size={12} /> {status}</span>;
  }
  return <span style={{ color: 'var(--warning)', fontSize: '0.75rem' }}>{status}</span>;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>('');

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await notificationsApi.getNotifications({ page, limit: 20, status: filterStatus || undefined });
      const data = res.data.data;
      setNotifications(data?.items ?? []);
      setTotalPages(data?.totalPages ?? 1);
      setTotal(data?.total ?? 0);
    } catch {
      setError('Failed to load notifications. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [page, filterStatus]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return (
    <div className="page animate-fade-in" style={{ maxWidth: 840 }}>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <div className="sub">{total > 0 ? `${total} total notifications` : 'System alerts and order updates'}</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 7 }}>
            <Filter size={13} color="var(--ink-3)" />
            <select className="select" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} style={{ width: 140, padding: '7px 30px 7px 11px', fontSize: '0.8125rem' }}>
              <option value="">All status</option>
              <option value="PENDING">Pending</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchNotifications}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="row" style={{ gap: 8, padding: '13px 17px', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--r-md)', color: 'var(--danger)', fontSize: '0.875rem', marginBottom: 18 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '76px 0' }}>
          <Loader2 size={28} color="var(--brand)" style={{ animation: 'spin 1s linear infinite', margin: '0 auto' }} />
        </div>
      ) : notifications.length === 0 ? (
        <div className="glass-card" style={{ padding: '56px 24px', textAlign: 'center' }}>
          <Bell size={44} color="var(--ink-3)" style={{ margin: '0 auto 14px', opacity: 0.6 }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 6 }}>No notifications</h3>
          <p className="t-muted">Notifications will appear here when orders are processed or alerts are triggered.</p>
        </div>
      ) : (
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          {notifications.map((notif, idx) => (
            <div
              key={notif.id}
              className="row notif-row"
              style={{
                gap: 15, padding: '16px 20px', alignItems: 'flex-start',
                borderBottom: idx < notifications.length - 1 ? '1px solid var(--line)' : 'none',
                background: notif.status === 'PENDING' ? 'var(--brand-soft)' : 'transparent',
              }}
            >
              <span className="row" style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--surface-3)', color: 'var(--ink-2)', justifyContent: 'center', flexShrink: 0 }}>
                <NotifIcon type={notif.type} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="between" style={{ gap: 10, marginBottom: 5 }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{notif.title}</span>
                  <span className="t-muted" style={{ fontSize: '0.75rem', flexShrink: 0 }}>{formatRelativeTime(notif.createdAt)}</span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 9 }}>{notif.message}</p>
                <div className="row" style={{ gap: 8 }}>
                  <ChannelBadge channel={notif.channel} />
                  <StatusBadge status={notif.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && !isLoading && (
        <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 22 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
          <span className="t-muted" style={{ padding: '0 8px', display: 'flex', alignItems: 'center' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
        </div>
      )}

      <style>{`.notif-row:hover { background: var(--surface-2); }`}</style>
    </div>
  );
}
