'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, Building2, User } from '../../components/icons';
import { useAuth } from '../../lib/auth-context';

// Mirrors the backend's SECURITY.md §14 policy (min 12 chars, upper, lower,
// digit, special char) — see backend/src/common/validators/strong-password.validator.ts.
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!STRONG_PASSWORD_REGEX.test(password)) {
      setError('Password must be at least 12 characters and include uppercase, lowercase, a number, and a special character.');
      return;
    }
    setIsLoading(true);
    try {
      await register({ businessName, ownerName, email, password });
      router.push('/dashboard');
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const iconStyle = { position: 'absolute' as const, left: 13, top: '50%', transform: 'translateY(-50%)' };

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>
      {/* ── Editorial panel ───────────────────────────────────────── */}
      <aside className="auth-brand stack" style={{ justifyContent: 'space-between', padding: 'clamp(40px, 5vw, 64px)', background: 'var(--surface-1)', borderRight: '1px solid var(--line)' }}>
        <div className="row" style={{ gap: 11 }}>
          <div className="row" style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--brand)', justifyContent: 'center' }}>
            <Zap size={17} color="var(--ink-on-brand)" strokeWidth={2.5} />
          </div>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem', letterSpacing: '-0.01em' }}>CommercePilot</span>
        </div>

        <p className="font-display" style={{ fontSize: 'clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)', lineHeight: 1.18, color: 'var(--ink)', maxWidth: 460 }}>
          Your storefront,
          <br />
          <span style={{ color: 'var(--ink-3)' }}>on</span> <span style={{ fontStyle: 'italic', color: 'var(--brand)' }}>autopilot</span>.
        </p>

        <p className="t-muted" style={{ fontSize: '0.8125rem', maxWidth: 380, lineHeight: 1.6 }}>
          Connect your store, plug in WhatsApp, and let AI handle the order-entry busywork — with you approving every decision.
        </p>
      </aside>

      {/* ── Form panel ────────────────────────────────────────────── */}
      <main className="row" style={{ flex: 1, justifyContent: 'center', padding: 'clamp(24px, 5vw, 56px)' }}>
        <div className="animate-fade-in stack" style={{ width: '100%', maxWidth: 380, gap: 28 }}>
          <div className="auth-mobile-brand row" style={{ gap: 11 }}>
            <div className="row" style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--brand)', justifyContent: 'center' }}>
              <Zap size={17} color="var(--ink-on-brand)" strokeWidth={2.5} />
            </div>
            <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>CommercePilot</span>
          </div>

          <div className="stack" style={{ gap: 7 }}>
            <h1 className="font-display" style={{ fontSize: '1.9rem', color: 'var(--ink)' }}>Create your account</h1>
            <p className="t-muted">Start automating WhatsApp orders in minutes.</p>
          </div>

          <form onSubmit={handleSubmit} className="stack" style={{ gap: 16 }}>
            {error && (
              <div style={{ padding: '11px 14px', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--r-md)', color: 'var(--danger)', fontSize: '0.8125rem' }}>
                {error}
              </div>
            )}

            <label className="stack" style={{ gap: 8 }}>
              Business name
              <div style={{ position: 'relative' }}>
                <Building2 size={16} color="var(--ink-3)" style={iconStyle} />
                <input className="input" type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Nimal's Uniform Store" required style={{ paddingLeft: 39 }} />
              </div>
            </label>

            <label className="stack" style={{ gap: 8 }}>
              Your name
              <div style={{ position: 'relative' }}>
                <User size={16} color="var(--ink-3)" style={iconStyle} />
                <input className="input" type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Nimal Perera" required style={{ paddingLeft: 39 }} />
              </div>
            </label>

            <label className="stack" style={{ gap: 8 }}>
              Email address
              <div style={{ position: 'relative' }}>
                <Mail size={16} color="var(--ink-3)" style={iconStyle} />
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" required style={{ paddingLeft: 39 }} />
              </div>
            </label>

            <label className="stack" style={{ gap: 8 }}>
              Password
              <div style={{ position: 'relative' }}>
                <Lock size={16} color="var(--ink-3)" style={iconStyle} />
                <input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 12 characters" required minLength={12} style={{ paddingLeft: 39, paddingRight: 42 }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4, display: 'flex' }} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <span className="t-muted" style={{ fontSize: '0.6875rem', lineHeight: 1.5 }}>Min 12 characters, incl. uppercase, lowercase, a number, and a special character.</span>
            </label>

            <button type="submit" className="btn btn-primary" disabled={isLoading} style={{ height: 46, marginTop: 2 }}>
              {isLoading ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <>Create account <ArrowRight size={16} /></>}
            </button>
          </form>

          <p className="t-muted" style={{ textAlign: 'center' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--brand)', textDecoration: 'none', fontWeight: 600 }}>Sign in</Link>
          </p>
        </div>
      </main>

      <style>{`
        .auth-brand { width: 48%; max-width: 640px; }
        .auth-mobile-brand { display: none; }
        @media (max-width: 900px) {
          .auth-brand { display: none; }
          .auth-mobile-brand { display: flex; }
        }
      `}</style>
    </div>
  );
}
