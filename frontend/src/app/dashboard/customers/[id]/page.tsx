'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Phone, Clock, ShoppingCart, MessageSquare, Loader2, Package, AlertCircle, Bot } from '../../../../components/icons';
import { customersApi } from '../../../../lib/api';

interface CustomerDetail {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  _count: { orders: number; whatsappMessages: number };
}

interface OrderItem {
  id: string;
  product?: { name: string; sku?: string };
  matchedProductName?: string;
  quantity: number;
  unitPrice: number;
}

interface Order {
  id: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  items: OrderItem[];
}

interface Message {
  id: string;
  messageText: string;
  direction: 'INBOUND' | 'OUTBOUND';
  createdAt: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

export default function CustomerDetailPage() {
  const router = useRouter();
  // Next.js 16: `params` is now async in Server Components; client components
  // must read it via useParams() rather than a destructured prop (see Phase 8
  // fix — the old pattern produced /customers/undefined and 500s everywhere).
  const params = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'messages'>('orders');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [custRes, ordRes, msgRes] = await Promise.all([
        customersApi.getCustomer(params.id),
        customersApi.getCustomerOrders(params.id),
        customersApi.getCustomerMessages(params.id, 50),
      ]);
      setCustomer(custRes.data.data);
      setOrders(ordRes.data.data);
      setMessages(msgRes.data.data);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to load customer details');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: '100px 0' }}>
        <Loader2 size={28} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="page" style={{ maxWidth: 800, textAlign: 'center', padding: '56px 0' }}>
        <AlertCircle size={40} color="var(--danger)" style={{ margin: '0 auto 14px' }} />
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: 6 }}>Customer not found</h2>
        <p className="t-muted" style={{ marginBottom: 20 }}>{error || 'The requested customer profile could not be loaded.'}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard/customers')} style={{ display: 'inline-flex' }}>
          <ArrowLeft size={15} /> Back to Customers
        </button>
      </div>
    );
  }

  return (
    <div className="page animate-fade-in">
      <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard/customers')} style={{ marginBottom: 20, display: 'inline-flex' }}>
        <ArrowLeft size={15} /> Back to Customers
      </button>

      {/* Customer Header Card */}
      <div className="glass-card customer-header" style={{ padding: 'clamp(20px, 3vw, 28px)', marginBottom: 20 }}>
        <span className="row" style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--violet-soft)', color: 'var(--violet)', justifyContent: 'center', fontWeight: 700, fontSize: '1.75rem', flexShrink: 0 }}>
          {customer.name.charAt(0).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="font-display" style={{ fontSize: '1.5rem', marginBottom: 8 }}>{customer.name}</h1>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', color: 'var(--ink-2)', fontSize: '0.875rem' }}>
            <span className="row" style={{ gap: 6 }}><Phone size={15} color="var(--info)" /> {customer.phone}</span>
            <span className="row" style={{ gap: 6 }}><Clock size={15} color="var(--brand)" /> Added {new Date(customer.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ background: 'var(--surface-2)', padding: '11px 18px', borderRadius: 'var(--r-md)', border: '1px solid var(--line)', textAlign: 'center', minWidth: 92 }}>
            <div className="metric" style={{ fontSize: '1.375rem', color: 'var(--info)', marginBottom: 3 }}>{customer._count.orders}</div>
            <div className="t-eyebrow">Orders</div>
          </div>
          <div style={{ background: 'var(--surface-2)', padding: '11px 18px', borderRadius: 'var(--r-md)', border: '1px solid var(--line)', textAlign: 'center', minWidth: 92 }}>
            <div className="metric" style={{ fontSize: '1.375rem', color: 'var(--brand)', marginBottom: 3 }}>{customer._count.whatsappMessages}</div>
            <div className="t-eyebrow">Messages</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="row" style={{ gap: 4, marginBottom: 20, borderBottom: '1px solid var(--line)' }}>
        <button onClick={() => setActiveTab('orders')} className="detail-tab" data-active={activeTab === 'orders'}>
          <ShoppingCart size={16} /> Order History
        </button>
        <button onClick={() => setActiveTab('messages')} className="detail-tab" data-active={activeTab === 'messages'}>
          <MessageSquare size={16} /> Conversation Log
        </button>
      </div>

      {/* Tab Content */}
      <div className="glass-card" style={{ padding: 'clamp(16px, 3vw, 22px)' }}>
        {activeTab === 'orders' && (
          <div className="animate-fade-in">
            {orders.length === 0 ? (
              <div style={{ padding: '36px 0', textAlign: 'center' }}>
                <Package size={40} color="var(--ink-3)" style={{ margin: '0 auto 14px', opacity: 0.5 }} />
                <p className="t-muted">This customer has not placed any orders yet.</p>
              </div>
            ) : (
              <div className="stack" style={{ gap: 14 }}>
                {orders.map(order => (
                  <div key={order.id} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 18 }}>
                    <div className="between order-summary" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--line)', gap: 12 }}>
                      <div>
                        <div className="t-eyebrow" style={{ marginBottom: 4 }}>Order ID</div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{order.id}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="t-muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>{new Date(order.createdAt).toLocaleString()}</div>
                        <span className={`badge ${order.status === 'SYNCED' ? 'badge-info' : 'badge-neutral'}`}>{order.status}</span>
                      </div>
                    </div>

                    <div className="stack" style={{ gap: 11 }}>
                      {order.items.map((item, idx) => (
                        <div key={item.id || idx} className="between">
                          <div className="row" style={{ gap: 11 }}>
                            <span className="row" style={{ width: 30, height: 30, background: 'var(--surface-2)', borderRadius: 8, justifyContent: 'center', flexShrink: 0 }}>
                              <Package size={13} color="var(--ink-3)" />
                            </span>
                            <div>
                              <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{item.product?.name || item.matchedProductName || 'Unknown Product'}</div>
                              <div className="t-muted" style={{ fontSize: '0.75rem' }}>Qty: {item.quantity} × {formatCurrency(Number(item.unitPrice))}</div>
                            </div>
                          </div>
                          <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{formatCurrency(item.quantity * Number(item.unitPrice))}</div>
                        </div>
                      ))}
                    </div>

                    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--line)' }}>
                      <div className="metric" style={{ fontSize: '1rem' }}>Total: {formatCurrency(Number(order.totalAmount))}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="animate-fade-in stack" style={{ gap: 14, maxHeight: 560, overflowY: 'auto', padding: 4 }}>
            {messages.length === 0 ? (
              <div style={{ padding: '36px 0', textAlign: 'center' }}>
                <MessageSquare size={40} color="var(--ink-3)" style={{ margin: '0 auto 14px', opacity: 0.5 }} />
                <p className="t-muted">No conversation history found.</p>
              </div>
            ) : (
              messages.map(msg => {
                const isInbound = msg.direction === 'INBOUND';
                return (
                  <div key={msg.id} className="stack" style={{ alignItems: isInbound ? 'flex-start' : 'flex-end', width: '100%' }}>
                    <div className="row" style={{ alignItems: 'flex-end', gap: 8, maxWidth: '80%' }}>
                      {isInbound && (
                        <span className="row" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--violet-soft)', color: 'var(--violet)', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                          {customer.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div style={{ background: isInbound ? 'var(--surface-2)' : 'var(--info-soft)', border: `1px solid ${isInbound ? 'var(--line)' : 'var(--info)'}`, padding: '11px 15px', borderRadius: 15, borderBottomLeftRadius: isInbound ? 4 : 15, borderBottomRightRadius: !isInbound ? 4 : 15, fontSize: '0.8125rem', lineHeight: 1.5 }}>
                        {msg.messageText}
                      </div>
                      {!isInbound && (
                        <span className="row" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--info)', color: '#fff', justifyContent: 'center', flexShrink: 0 }}>
                          <Bot size={13} />
                        </span>
                      )}
                    </div>
                    <span className="t-muted" style={{ fontSize: '0.6875rem', marginTop: 4, padding: '0 34px' }}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <style>{`
        .customer-header { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
        .detail-tab {
          padding: 11px 20px; background: none; border: none; cursor: pointer;
          border-bottom: 2px solid transparent; color: var(--ink-3); font-weight: 500;
          font-size: 0.875rem; display: flex; align-items: center; gap: 8px;
          transition: all var(--dur-1) var(--ease); font-family: inherit;
        }
        .detail-tab[data-active="true"] { border-bottom-color: var(--brand); color: var(--brand); font-weight: 600; }
        @media (max-width: 560px) {
          .order-summary { flex-direction: column; align-items: flex-start !important; }
          .order-summary > div:last-child { text-align: left !important; }
        }
      `}</style>
    </div>
  );
}
