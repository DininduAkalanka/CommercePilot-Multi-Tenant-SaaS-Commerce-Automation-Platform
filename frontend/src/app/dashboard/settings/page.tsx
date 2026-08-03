'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { useTheme } from '../../../lib/theme-context';
import { settingsApi } from '../../../lib/api';
import {
  Building2,
  Key,
  MessageCircle,
  Database,
  Save,
  Loader2,
  Check,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Eye,
  EyeOff,
} from '../../../components/icons';

// ── Types ─────────────────────────────────────────────────────────
interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  whatsappPhoneNumberId: string | null;
  whatsappProvider: string;
  woocommerceUrl: string | null;
  woocommerceProvider: string;
  aiConfidenceThreshold: number;
  autoApproveEnabled: boolean;
  autoApproveThreshold: number;
  businessHours: Record<string, unknown> | null;
}

// ── Toast component ────────────────────────────────────────────────
function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  const color = type === 'success' ? 'var(--brand)' : 'var(--danger)';
  return (
    <div
      className="row animate-fade-in"
      style={{
        position: 'fixed', bottom: 24, right: 24, gap: 10,
        padding: '12px 16px', borderRadius: 'var(--r-md)',
        background: 'var(--surface-2)', border: '1px solid var(--line-strong)',
        color: 'var(--ink)', fontSize: '0.875rem', fontWeight: 500,
        boxShadow: 'var(--shadow-lg)', zIndex: 1000, maxWidth: 'calc(100vw - 48px)',
      }}
    >
      <span style={{ color, display: 'flex' }}>{type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}</span>
      {message}
    </div>
  );
}

// ── Tab definition ────────────────────────────────────────────────
const TABS = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'whatsapp', label: 'WhatsApp API', icon: MessageCircle },
  { id: 'integrations', label: 'Integrations', icon: Database },
  { id: 'ai', label: 'AI Configuration', icon: Key },
];

// ── Main Page ─────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // WooCommerce form state
  const [wooUrl, setWooUrl] = useState('');
  const [wooKey, setWooKey] = useState('');
  const [wooSecret, setWooSecret] = useState('');
  const [showWooKey, setShowWooKey] = useState(false);
  const [showWooSecret, setShowWooSecret] = useState(false);

  // WhatsApp form state
  const [waPhoneNumberId, setWaPhoneNumberId] = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');
  const [waVerifyToken, setWaVerifyToken] = useState('');
  const [showWaToken, setShowWaToken] = useState(false);

  // AI config form state
  const [aiThreshold, setAiThreshold] = useState(85);
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [autoApproveThreshold, setAutoApproveThreshold] = useState(95);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await settingsApi.getSettings();
      const data: TenantSettings = res.data.data;
      setSettings(data);
      // Sync local form state
      setWooUrl(data.woocommerceUrl ?? '');
      setAiThreshold(Math.round(data.aiConfidenceThreshold * 100));
      setAutoApproveEnabled(data.autoApproveEnabled);
      setAutoApproveThreshold(Math.round(data.autoApproveThreshold * 100));
      setWaPhoneNumberId(data.whatsappPhoneNumberId ?? '');
    } catch {
      showToast('Failed to load settings', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ── Save handlers per tab ──────────────────────────────────────

  const saveAiConfig = async () => {
    setIsSaving(true);
    try {
      await settingsApi.updateSettings({
        aiConfidenceThreshold: aiThreshold / 100,
        autoApproveEnabled,
        autoApproveThreshold: autoApproveThreshold / 100,
      });
      showToast('AI configuration saved', 'success');
      await loadSettings();
    } catch {
      showToast('Failed to save AI configuration', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const saveWooCommerce = async () => {
    setIsSaving(true);
    try {
      await settingsApi.updateSettings({
        woocommerceUrl: wooUrl || undefined,
        ...(wooKey ? { woocommerceKey: wooKey } : {}),
        ...(wooSecret ? { woocommerceSecret: wooSecret } : {}),
      });
      showToast('WooCommerce settings saved', 'success');
      await loadSettings();
    } catch {
      showToast('Failed to save WooCommerce settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const saveWhatsApp = async () => {
    setIsSaving(true);
    try {
      await settingsApi.updateSettings({
        ...(waPhoneNumberId ? { whatsappPhoneNumberId: waPhoneNumberId } as Record<string, unknown> : {}),
        ...(waAccessToken ? { whatsappAccessToken: waAccessToken } as Record<string, unknown> : {}),
        ...(waVerifyToken ? { whatsappVerifyToken: waVerifyToken } as Record<string, unknown> : {}),
      } as Parameters<typeof settingsApi.updateSettings>[0]);
      showToast('WhatsApp API settings saved', 'success');
      setWaAccessToken('');
      await loadSettings();
    } catch {
      showToast('Failed to save WhatsApp settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '100px 0' }}>
        <Loader2 size={32} color="var(--accent-green)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="page animate-fade-in" style={{ maxWidth: 980 }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Manage your business preferences and integrations</div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {settings && (
            <span className="badge badge-approved">
              <span style={{ width: 6, height: 6, background: 'var(--brand)', borderRadius: '50%' }} />
              {settings.plan} · Active
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={loadSettings}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="settings-grid">
        {/* Sidebar Nav */}
        <div className="stack settings-nav" style={{ gap: 2 }}>
          {TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="row"
                style={{
                  gap: 10, padding: '9px 12px', borderRadius: 'var(--r-md)', border: 'none',
                  background: isActive ? 'var(--surface-3)' : 'transparent',
                  color: isActive ? 'var(--ink)' : 'var(--ink-2)',
                  fontWeight: isActive ? 600 : 500, fontSize: '0.875rem',
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  transition: 'background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)',
                }}
              >
                <TabIcon size={16} color={isActive ? 'var(--brand)' : 'currentColor'} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="card" style={{ padding: 'clamp(20px, 3vw, 32px)' }}>
          {/* ── GENERAL TAB — Claude-style rows ─────────────────── */}
          {activeTab === 'general' && (
            <div className="animate-fade-in">
              <h2 className="font-display" style={{ fontSize: '1.375rem', marginBottom: 4 }}>Business Profile</h2>
              <p className="t-muted" style={{ marginBottom: 20 }}>Your account details. Contact support to change your business name or email.</p>
              <div className="stack">
                {[
                  { label: 'Business name', value: user?.businessName, sub: null },
                  { label: 'Owner name', value: user?.name, sub: null },
                  { label: 'Email address', value: user?.email, sub: null },
                  { label: 'Your role', value: user?.role, sub: null },
                  { label: 'Tenant ID', value: user?.tenantId, mono: true, sub: 'Your unique workspace identifier — never share it publicly.' },
                ].map((field, i, arr) => (
                  <div key={field.label} className="setting-row" style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <div className="stack" style={{ gap: 3 }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--ink)' }}>{field.label}</span>
                      {field.sub && <span className="t-muted" style={{ fontSize: '0.75rem', maxWidth: 360 }}>{field.sub}</span>}
                    </div>
                    <span style={{ fontSize: '0.875rem', color: 'var(--ink-2)', textAlign: 'right', fontFamily: field.mono ? 'ui-monospace, monospace' : 'inherit', wordBreak: field.mono ? 'break-all' : 'normal' }}>
                      {field.value ?? '—'}
                    </span>
                  </div>
                ))}
              </div>

              <h2 className="font-display" style={{ fontSize: '1.375rem', marginTop: 36, marginBottom: 4 }}>Appearance</h2>
              <p className="t-muted" style={{ marginBottom: 8 }}>Choose how CommercePilot looks on this device.</p>
              <div className="setting-row" style={{ borderBottom: 'none' }}>
                <div className="stack" style={{ gap: 3 }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--ink)' }}>Dark mode</span>
                  <span className="t-muted" style={{ fontSize: '0.75rem', maxWidth: 360 }}>Defaults to light. Switch on for a warm near-black theme instead.</span>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={theme === 'dark'} onChange={toggleTheme} aria-label="Toggle dark mode" />
                  <span className="switch-track" />
                  <span className="switch-thumb" />
                </label>
              </div>
            </div>
          )}

          {/* ── WHATSAPP TAB ────────────────────────────────────── */}
          {activeTab === 'whatsapp' && (
            <div className="animate-fade-in">
              <h2 className="font-display" style={{ fontSize: '1.375rem', marginBottom: 4 }}>WhatsApp Business API</h2>
              <p className="t-muted" style={{ marginBottom: 20 }}>Connect your Meta Cloud API account to enable real WhatsApp messaging.</p>

              {/* Provider status */}
              <div
                className="row"
                style={{
                  padding: '13px 16px', gap: 11, marginBottom: 22, borderRadius: 'var(--r-md)',
                  background: settings?.whatsappProvider === 'MOCK' ? 'var(--warning-soft)' : 'var(--brand-soft)',
                  border: `1px solid ${settings?.whatsappProvider === 'MOCK' ? 'var(--warning)' : 'var(--brand)'}`,
                }}
              >
                <MessageCircle size={16} color={settings?.whatsappProvider === 'MOCK' ? 'var(--warning)' : 'var(--brand)'} style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink)' }}>
                    {settings?.whatsappProvider === 'MOCK' ? 'Mock Mode (Simulator active)' : 'Meta Cloud API Connected'}
                  </div>
                  <div className="t-muted" style={{ fontSize: '0.75rem' }}>
                    {settings?.whatsappProvider === 'MOCK'
                      ? 'Configure below to switch to real WhatsApp Business API'
                      : 'Real WhatsApp messages are enabled'}
                  </div>
                </div>
              </div>

              <div className="stack" style={{ gap: 18 }}>
                <label className="stack" style={{ gap: 6 }}>
                  Webhook URL (copy this into Meta Cloud API)
                  <div className="wa-copy-row">
                    <input
                      className="input"
                      value={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/whatsapp/webhook`}
                      readOnly
                      autoComplete="off"
                      style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/whatsapp/webhook`)}
                      style={{ flexShrink: 0 }}
                    >
                      Copy
                    </button>
                  </div>
                </label>

                <label className="stack" style={{ gap: 6 }}>
                  Phone Number ID
                  <input
                    className="input"
                    placeholder="e.g. 108234567890123"
                    value={waPhoneNumberId}
                    onChange={(e) => setWaPhoneNumberId(e.target.value)}
                    autoComplete="off"
                  />
                </label>

                <label className="stack" style={{ gap: 6 }}>
                  Access token
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      type={showWaToken ? 'text' : 'password'}
                      placeholder="EAAGxxxx..."
                      value={waAccessToken}
                      onChange={(e) => setWaAccessToken(e.target.value)}
                      autoComplete="new-password"
                      style={{ paddingRight: 44 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowWaToken(!showWaToken)}
                      aria-label={showWaToken ? 'Hide token' : 'Show token'}
                      className="input-eye-btn"
                    >
                      {showWaToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <span className="t-muted" style={{ fontSize: '0.75rem' }}>Leave blank to keep the existing token unchanged.</span>
                </label>

                <label className="stack" style={{ gap: 6 }}>
                  Verify token
                  <input
                    className="input"
                    placeholder="Custom verification token"
                    value={waVerifyToken}
                    onChange={(e) => setWaVerifyToken(e.target.value)}
                    autoComplete="off"
                  />
                </label>

                <div className="row wrap" style={{ gap: 10 }}>
                  <button className="btn btn-primary" onClick={saveWhatsApp} disabled={isSaving}>
                    {isSaving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
                    Save WhatsApp settings
                  </button>
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/cloud-api/"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost"
                    style={{ textDecoration: 'none' }}
                  >
                    <ExternalLink size={14} /> Meta docs
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* ── INTEGRATIONS TAB ────────────────────────────────── */}
          {activeTab === 'integrations' && (
            <div className="animate-fade-in">
              <h2 className="font-display" style={{ fontSize: '1.375rem', marginBottom: 4 }}>E-commerce Integrations</h2>
              <p className="t-muted" style={{ marginBottom: 20 }}>Connect your store to sync products, inventory, and orders automatically.</p>

              {/* WooCommerce */}
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
                <div className="row" style={{ padding: 18, borderBottom: '1px solid var(--line)', gap: 12 }}>
                  <span className="row" style={{ width: 42, height: 42, background: '#96588a', borderRadius: 10, justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.6875rem', flexShrink: 0 }}>
                    Woo
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>WooCommerce</div>
                    <div className="row" style={{ gap: 4, fontSize: '0.75rem', color: settings?.woocommerceProvider !== 'MOCK' ? 'var(--brand)' : 'var(--ink-3)' }}>
                      {settings?.woocommerceProvider !== 'MOCK'
                        ? <><Check size={12} /> Connected</>
                        : settings?.woocommerceUrl ? 'URL configured' : 'Not connected'}
                    </div>
                  </div>
                </div>

                <div className="stack" style={{ padding: 18, gap: 16 }}>
                  <label className="stack" style={{ gap: 6 }}>
                    Store URL
                    <input className="input" placeholder="https://yourstore.com" value={wooUrl} onChange={(e) => setWooUrl(e.target.value)} autoComplete="off" />
                  </label>

                  <label className="stack" style={{ gap: 6 }}>
                    Consumer key
                    <div style={{ position: 'relative' }}>
                      <input
                        className="input"
                        type={showWooKey ? 'text' : 'password'}
                        placeholder="ck_xxxxxxxx"
                        value={wooKey}
                        onChange={(e) => setWooKey(e.target.value)}
                        autoComplete="new-password"
                        style={{ paddingRight: 44 }}
                      />
                      <button type="button" onClick={() => setShowWooKey(!showWooKey)} aria-label={showWooKey ? 'Hide key' : 'Show key'} className="input-eye-btn">
                        {showWooKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </label>

                  <label className="stack" style={{ gap: 6 }}>
                    Consumer secret
                    <div style={{ position: 'relative' }}>
                      <input
                        className="input"
                        type={showWooSecret ? 'text' : 'password'}
                        placeholder="cs_xxxxxxxx"
                        value={wooSecret}
                        onChange={(e) => setWooSecret(e.target.value)}
                        autoComplete="new-password"
                        style={{ paddingRight: 44 }}
                      />
                      <button type="button" onClick={() => setShowWooSecret(!showWooSecret)} aria-label={showWooSecret ? 'Hide secret' : 'Show secret'} className="input-eye-btn">
                        {showWooSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <span className="t-muted" style={{ fontSize: '0.75rem' }}>Credentials are stored securely. Leave blank to keep existing values.</span>
                  </label>

                  <button className="btn btn-primary" onClick={saveWooCommerce} disabled={isSaving} style={{ alignSelf: 'flex-start' }}>
                    {isSaving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
                    Save WooCommerce
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── AI CONFIG TAB ────────────────────────────────────── */}
          {activeTab === 'ai' && (
            <div className="animate-fade-in">
              <h2 className="font-display" style={{ fontSize: '1.375rem', marginBottom: 4 }}>AI Configuration</h2>
              <p className="t-muted" style={{ marginBottom: 24 }}>Tune how the AI engine processes and routes orders.</p>

              <div className="stack" style={{ gap: 26 }}>
                {/* Confidence threshold */}
                <div>
                  <div className="between wrap" style={{ marginBottom: 10, gap: 10 }}>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Manual review threshold</div>
                      <div className="t-muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>Orders with confidence below this go to the manual review queue.</div>
                    </div>
                    <span className="metric" style={{ fontSize: '1.375rem', color: 'var(--brand)' }}>{aiThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="1"
                    value={aiThreshold}
                    onChange={(e) => setAiThreshold(Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--brand)', cursor: 'pointer' }}
                  />
                  <div className="between t-muted" style={{ fontSize: '0.6875rem', marginTop: 4 }}>
                    <span>50% (Permissive)</span>
                    <span>100% (Strict)</span>
                  </div>
                </div>

                {/* Auto-approve toggle */}
                <div style={{ padding: 18, background: 'var(--surface-1)', borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }}>
                  <div className="between wrap" style={{ gap: 12 }}>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Auto-approve high-confidence orders</div>
                      <div className="t-muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>Skip manual review for orders above the auto-approve threshold.</div>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={autoApproveEnabled} onChange={() => setAutoApproveEnabled(!autoApproveEnabled)} />
                      <span className="switch-track" />
                      <span className="switch-thumb" />
                    </label>
                  </div>

                  {autoApproveEnabled && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                      <div className="between" style={{ marginBottom: 8 }}>
                        <span className="t-muted" style={{ fontSize: '0.8125rem' }}>Auto-approve threshold</span>
                        <span className="metric" style={{ fontSize: '0.8125rem', color: 'var(--info)' }}>{autoApproveThreshold}%</span>
                      </div>
                      <input
                        type="range"
                        min={aiThreshold}
                        max="100"
                        step="1"
                        value={autoApproveThreshold}
                        onChange={(e) => setAutoApproveThreshold(Number(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--info)', cursor: 'pointer' }}
                      />
                    </div>
                  )}
                </div>

                {/* Info card */}
                <div style={{ padding: 15, background: 'var(--info-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--info)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
                  <strong>How it works:</strong> the AI assigns a confidence score (0–100%) to each extracted order draft.
                  Orders below <strong>{aiThreshold}%</strong> go to manual review.
                  {autoApproveEnabled && (
                    <> Orders above <strong>{autoApproveThreshold}%</strong> are auto-approved without any human review.</>
                  )}
                </div>

                <button className="btn btn-primary" onClick={saveAiConfig} disabled={isSaving} style={{ alignSelf: 'flex-start' }}>
                  {isSaving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
                  Save AI configuration
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} />}

      <style>{`
        .settings-grid { display: grid; grid-template-columns: 200px 1fr; gap: 24px; align-items: start; }
        .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 0; flex-wrap: wrap; }
        .wa-copy-row { display: flex; gap: 8px; }
        .wa-copy-row .input { flex: 1; min-width: 0; }
        .input-eye-btn {
          position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
          width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer; color: var(--ink-3); border-radius: var(--r-sm);
          transition: color var(--dur-1) var(--ease), background var(--dur-1) var(--ease);
        }
        .input-eye-btn:hover { color: var(--ink); background: var(--surface-3); }
        @media (max-width: 720px) {
          .settings-grid { grid-template-columns: 1fr; gap: 16px; }
          .settings-nav { flex-direction: row; overflow-x: auto; gap: 6px; padding-bottom: 4px; }
          .settings-nav button { white-space: nowrap; }
        }
        @media (max-width: 480px) {
          .wa-copy-row { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
