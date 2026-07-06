'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Phone, ShoppingCart, MessageSquare, Loader2, Users, ChevronRight } from '../../../components/icons';
import { customersApi } from '../../../lib/api';

interface Customer {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  _count: {
    orders: number;
    whatsappMessages: number;
  };
}

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await customersApi.getCustomers({ page, limit: 15, search: debouncedSearch || undefined });
      setCustomers(res.data.data.customers);
      setTotalPages(res.data.data.totalPages);
      setTotal(res.data.data.total);
    } catch (err) {
      console.error('Failed to load customers', err);
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  return (
    <div className="page animate-fade-in">
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <div className="sub">Manage your customer relationships and order history</div>
        </div>
        <span className="badge badge-approved" style={{ padding: '6px 12px' }}>
          <Users size={13} /> {total} total
        </span>
      </div>

      <div className="card" style={{ padding: 'clamp(16px, 3vw, 24px)' }}>
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <Search size={16} color="var(--ink-3)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            className="input"
            placeholder="Search customers by name or phone number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 39, maxWidth: 400 }}
          />
        </div>

        {isLoading ? (
          <div className="row" style={{ justifyContent: 'center', padding: '56px 0' }}>
            <Loader2 size={26} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : customers.length === 0 ? (
          <div className="stack" style={{ alignItems: 'center', padding: '56px 0', gap: 10 }}>
            <Users size={40} color="var(--ink-3)" style={{ opacity: 0.5 }} />
            <p className="t-muted">No customers found matching &quot;{debouncedSearch}&quot;</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Orders</th>
                  <th>Messages</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/dashboard/customers/${c.id}`)} style={{ cursor: 'pointer' }}>
                    <td data-label="Customer">
                      <div className="row" style={{ gap: 11 }}>
                        <span className="row" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--violet-soft)', color: 'var(--violet)', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
                          {c.name.charAt(0).toUpperCase()}
                        </span>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                      </div>
                    </td>
                    <td data-label="Phone">
                      <div className="row" style={{ gap: 7, color: 'var(--ink-2)' }}>
                        <Phone size={13} /> {c.phone}
                      </div>
                    </td>
                    <td data-label="Orders">
                      <div className="row" style={{ gap: 6, color: 'var(--ink-2)' }}>
                        <ShoppingCart size={13} color="var(--info)" /> {c._count.orders}
                      </div>
                    </td>
                    <td data-label="Messages">
                      <div className="row" style={{ gap: 6, color: 'var(--ink-2)' }}>
                        <MessageSquare size={13} color="var(--brand)" /> {c._count.whatsappMessages}
                      </div>
                    </td>
                    <td data-label="Added" style={{ color: 'var(--ink-2)', fontSize: '0.8125rem' }}>
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td data-label="" style={{ textAlign: 'right' }}>
                      <ChevronRight size={16} color="var(--ink-3)" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && !isLoading && (
          <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 20 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
            <span className="t-muted" style={{ padding: '0 8px', display: 'flex', alignItems: 'center' }}>Page {page} of {totalPages}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
