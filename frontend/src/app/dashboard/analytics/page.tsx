'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { TrendingUp, ShoppingBag, DollarSign, Activity, Loader2, AlertCircle, RefreshCw, Bot } from '../../../components/icons';
import { ordersApi } from '../../../lib/api';

interface AnalyticsData {
  dailyOrders: { date: string; count: number }[];
  statusBreakdown: Record<string, number>;
  totalRevenue: number;
  aiConfidenceAvg: number;
  approvalRate: number;
  totalOrders: number;
  totalDrafts: number;
}

// Warm, restrained palette — single brand accent + muted semantics (no bright multi-color chart).
const COLORS = ['#37b699', '#a68ae0', '#6f97d8', '#d6a24a', '#df6a52'];

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="glass-card row" style={{ padding: 22, alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <div className="t-eyebrow" style={{ marginBottom: 9 }}>{label}</div>
        <div className="metric" style={{ fontSize: '1.75rem' }}>{value}</div>
      </div>
      <span className="row" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={17} />
      </span>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await ordersApi.getAnalytics();
      setData(res.data.data);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load analytics data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (isLoading) {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: '100px 0' }}>
        <Loader2 size={28} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '56px 0', textAlign: 'center' }}>
        <AlertCircle size={40} color="var(--danger)" style={{ margin: '0 auto 14px' }} />
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: 6 }}>Analytics Error</h2>
        <p className="t-muted">{error}</p>
        <button className="btn btn-primary btn-sm" onClick={fetchAnalytics} style={{ marginTop: 16 }}>
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    );
  }

  const pieData = Object.entries(data.statusBreakdown).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  const formattedDailyOrders = data.dailyOrders.map((d) => ({
    ...d,
    displayDate: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <div className="page animate-fade-in">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">30-day performance overview</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchAnalytics}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid-auto" style={{ marginBottom: 20 }}>
        <StatCard label="Total Revenue" value={formatCurrency(data.totalRevenue)} icon={DollarSign} />
        <StatCard label="Total Orders" value={data.totalOrders} icon={ShoppingBag} />
        <StatCard label="Avg AI Confidence" value={`${data.aiConfidenceAvg}%`} icon={Bot} />
        <StatCard label="AI Draft Approval Rate" value={`${data.approvalRate}%`} icon={Activity} />
      </div>

      <div className="analytics-charts">
        {/* Daily Orders Line Chart */}
        <div className="glass-card stack" style={{ padding: 22, height: 380 }}>
          <div className="row" style={{ gap: 8, fontSize: '0.9375rem', fontWeight: 600, marginBottom: 20 }}>
            <TrendingUp size={17} color="var(--info)" /> Order Volume (30 Days)
          </div>
          <div style={{ flex: 1, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={formattedDailyOrders}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="displayDate" stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', borderRadius: 8, color: 'var(--ink)' }} itemStyle={{ color: 'var(--ink)' }} />
                <Line type="monotone" dataKey="count" name="Orders" stroke="var(--info)" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: 'var(--info)', stroke: 'var(--surface-1)', strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Order Status Pie Chart */}
        <div className="glass-card stack" style={{ padding: 22, height: 380 }}>
          <div className="row" style={{ gap: 8, fontSize: '0.9375rem', fontWeight: 600, marginBottom: 20 }}>
            <ShoppingBag size={17} color="var(--violet)" /> Order Status Breakdown
          </div>
          <div className="row" style={{ flex: 1, width: '100%', justifyContent: 'center' }}>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={64} outerRadius={92} paddingAngle={4} dataKey="value" nameKey="name" stroke="none">
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', borderRadius: 8, color: 'var(--ink)' }} itemStyle={{ color: 'var(--ink)' }} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" formatter={(value) => <span style={{ color: 'var(--ink-2)', fontSize: '0.8125rem' }}>{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="t-muted">No order data available</div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .analytics-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
      `}</style>
    </div>
  );
}
