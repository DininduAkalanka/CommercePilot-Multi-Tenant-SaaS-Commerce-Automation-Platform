'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
  Bell,
  ChevronDown,
  Zap,
  Menu,
  X,
  Loader2,
  ChevronRight,
  Sun,
  Moon,
} from '../../components/icons';
import { useAuth } from '../../lib/auth-context';
import { useTheme } from '../../lib/theme-context';
import { notificationsApi } from '../../lib/api';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: string;
  status: string;
  createdAt: string;
}

// Grouped navigation — sectioned like a refined settings panel.
const NAV_GROUPS: { label: string; items: { href: string; icon: typeof LayoutDashboard; label: string }[] }[] = [
  {
    label: 'Operations',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/dashboard/orders', icon: ShoppingCart, label: 'Orders' },
      { href: '/dashboard/customers', icon: Users, label: 'Customers' },
      { href: '/dashboard/products', icon: Package, label: 'Products' },
      { href: '/dashboard/simulator', icon: MessageSquare, label: 'WhatsApp' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/dashboard/analytics', icon: BarChart3, label: 'Analytics' },
      { href: '/dashboard/notifications', icon: Bell, label: 'Notifications' },
    ],
  },
  {
    label: 'Account',
    items: [{ href: '/dashboard/settings', icon: Settings, label: 'Settings' }],
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.getNotifications({ limit: 5 });
      const items: NotificationItem[] = res.data.data?.items ?? res.data.data?.notifications ?? [];
      setNotifications(items);
      setUnreadCount(items.filter((n) => n.status === 'PENDING').length);
    } catch {
      /* polling failures never disrupt the app */
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 30_000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchNotifications]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="row" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
        <Loader2 size={28} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const initials = (user?.businessName || 'C').charAt(0).toUpperCase();

  const isItemActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  // ── Sidebar (shared desktop + mobile) ────────────────────────────
  const SidebarContent = () => (
    <>
      {/* Brand */}
      <div className="row" style={{ gap: 11, padding: '18px 18px', borderBottom: '1px solid var(--line)' }}>
        <div
          className="row"
          style={{
            width: 34, height: 34, borderRadius: 10, background: 'var(--brand)',
            justifyContent: 'center', flexShrink: 0,
          }}
        >
          <Zap size={18} color="var(--ink-on-brand)" strokeWidth={2.5} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: '0.9375rem', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
            CommercePilot
          </div>
          <div className="t-muted" style={{ fontSize: '0.6875rem' }}>AI Operations</div>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="btn btn-ghost btn-icon mobile-close"
          style={{ marginLeft: 'auto', width: 32, height: 32, border: 'none' }}
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav groups */}
      <nav className="stack" style={{ flex: 1, padding: '14px 10px', gap: 18, overflowY: 'auto' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="stack" style={{ gap: 2 }}>
            <div className="t-eyebrow" style={{ padding: '0 10px 6px' }}>{group.label}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-link"
                  data-active={active}
                >
                  <span className="nav-indicator" aria-hidden />
                  <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
                    <Icon size={17} strokeWidth={active ? 2.25 : 2} />
                    {item.href === '/dashboard/notifications' && unreadCount > 0 && (
                      <span className="nav-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    )}
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sign out */}
      <div style={{ padding: '10px', borderTop: '1px solid var(--line)' }}>
        <button onClick={logout} className="nav-link" style={{ width: '100%' }}>
          <span className="nav-indicator" aria-hidden />
          <LogOut size={17} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', zIndex: 40 }}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className="stack mobile-sidebar"
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, width: 264,
          background: 'var(--surface-1)', borderRight: '1px solid var(--line)', zIndex: 50,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform var(--dur-3) var(--ease)',
        }}
      >
        <SidebarContent />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className="stack desktop-sidebar"
        style={{ width: 244, flexShrink: 0, background: 'var(--surface-1)', borderRight: '1px solid var(--line)' }}
      >
        <SidebarContent />
      </aside>

      {/* Main column */}
      <div className="stack" style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <header
          className="between"
          style={{
            height: 60, flexShrink: 0, gap: 12, padding: '0 16px',
            background: 'var(--surface-1)', borderBottom: '1px solid var(--line)',
          }}
        >
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <button onClick={() => setMobileOpen(true)} className="btn btn-ghost btn-icon mobile-menu-btn" aria-label="Open menu">
              <Menu size={18} />
            </button>
            <div className="row" style={{ gap: 8, fontSize: '0.8125rem', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>Starter</span>
              <span style={{ color: 'var(--line-strong)' }}>·</span>
              <span className="row" style={{ gap: 6, color: 'var(--brand)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--brand)' }} className="pulse-green" />
                Live
              </span>
            </div>
          </div>

          <div className="row" style={{ gap: 10 }}>
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="btn btn-ghost btn-icon theme-toggle"
              style={{ color: 'var(--ink-2)' }}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {/* Notifications */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="btn btn-ghost btn-icon"
                style={{ color: notifOpen ? 'var(--ink)' : 'var(--ink-2)', position: 'relative' }}
                aria-label="Notifications"
              >
                <Bell size={17} />
                {unreadCount > 0 && (
                  <span style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', border: '2px solid var(--surface-1)' }} />
                )}
              </button>

              {notifOpen && (
                <>
                  <div onClick={() => setNotifOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                  <div
                    className="animate-fade-in"
                    style={{
                      position: 'absolute', top: 46, right: 0, width: 340, maxWidth: 'calc(100vw - 32px)',
                      background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)',
                      boxShadow: 'var(--shadow-lg)', zIndex: 50, overflow: 'hidden',
                    }}
                  >
                    <div className="between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Notifications</span>
                      {unreadCount > 0 && <span className="badge badge-danger">{unreadCount} new</span>}
                    </div>
                    {notifications.length === 0 ? (
                      <div className="t-muted" style={{ padding: '28px 16px', textAlign: 'center' }}>No notifications yet</div>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: n.status === 'PENDING' ? 'var(--brand-soft)' : 'transparent' }}>
                          <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 3 }}>{n.title}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--ink-2)', lineHeight: 1.45 }}>
                            {n.message.length > 84 ? n.message.slice(0, 84) + '…' : n.message}
                          </div>
                          <div className="t-muted" style={{ fontSize: '0.6875rem', marginTop: 6 }}>
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      ))
                    )}
                    <Link
                      href="/dashboard/notifications"
                      onClick={() => setNotifOpen(false)}
                      className="row"
                      style={{ justifyContent: 'center', gap: 6, padding: 13, textDecoration: 'none', color: 'var(--brand)', fontSize: '0.8125rem', fontWeight: 600 }}
                    >
                      View all <ChevronRight size={14} />
                    </Link>
                  </div>
                </>
              )}
            </div>

            {/* Account menu */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setAccountOpen((v) => !v)}
                className="row user-chip"
                style={{ gap: 9, padding: '5px 10px 5px 6px', background: accountOpen ? 'var(--surface-3)' : 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', maxWidth: 190, cursor: 'pointer', fontFamily: 'inherit' }}
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
              >
                <span className="row" style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--brand-soft)', color: 'var(--brand)', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                  {initials}
                </span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="user-name">
                  {user?.businessName || 'My Store'}
                </span>
                <ChevronDown size={13} color="var(--ink-3)" style={{ flexShrink: 0, transform: accountOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-2) var(--ease)' }} />
              </button>

              {accountOpen && (
                <>
                  <div onClick={() => setAccountOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                  <div
                    className="animate-fade-in"
                    role="menu"
                    style={{
                      position: 'absolute', top: 46, right: 0, width: 260, maxWidth: 'calc(100vw - 32px)',
                      background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)',
                      boxShadow: 'var(--shadow-lg)', zIndex: 50, overflow: 'hidden',
                    }}
                  >
                    {/* Identity header */}
                    <div className="row" style={{ gap: 11, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
                      <span className="row" style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--brand-soft)', color: 'var(--brand)', justifyContent: 'center', fontSize: '0.9375rem', fontWeight: 700, flexShrink: 0 }}>
                        {initials}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {user?.businessName || 'My Store'}
                        </div>
                        <div className="t-muted" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {user?.email || '—'}
                        </div>
                      </div>
                    </div>

                    {/* Role line */}
                    {user?.role && (
                      <div className="between" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
                        <span className="t-muted" style={{ fontSize: '0.75rem' }}>Role</span>
                        <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>{user.role.toLowerCase()}</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ padding: 6 }}>
                      <Link href="/dashboard/settings" onClick={() => setAccountOpen(false)} className="account-item" role="menuitem">
                        <Settings size={16} /> Account settings
                      </Link>
                      <button
                        onClick={() => { setAccountOpen(false); toggleTheme(); }}
                        className="account-item"
                        role="menuitem"
                        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                      </button>
                    </div>

                    {/* Sign out */}
                    <div style={{ padding: 6, borderTop: '1px solid var(--line)' }}>
                      <button
                        onClick={logout}
                        className="account-item account-item-danger"
                        role="menuitem"
                        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        <LogOut size={16} /> Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: 'clamp(16px, 3vw, 28px)' }}>{children}</div>
        </main>
      </div>

      {/* Shell-scoped styles */}
      <style>{`
        .nav-link {
          position: relative;
          display: flex; align-items: center; gap: 11px;
          padding: 9px 12px; border-radius: var(--r-md);
          text-decoration: none; color: var(--ink-2);
          font-size: 0.875rem; font-weight: 500; white-space: nowrap;
          background: transparent; border: none; cursor: pointer;
          transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
        }
        .nav-link:hover { background: var(--surface-2); color: var(--ink); }
        .nav-link[data-active="true"] { background: var(--surface-3); color: var(--ink); font-weight: 600; }
        .nav-indicator {
          position: absolute; left: -10px; top: 50%; transform: translateY(-50%);
          width: 3px; height: 0; border-radius: var(--r-full); background: var(--brand);
          transition: height var(--dur-2) var(--ease);
        }
        .nav-link[data-active="true"] .nav-indicator { height: 20px; }
        .nav-dot {
          position: absolute; top: -6px; right: -7px; min-width: 15px; height: 15px;
          padding: 0 3px; background: var(--danger); color: #fff; border-radius: var(--r-full);
          font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; line-height: 1;
        }
        .account-item {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 10px; border-radius: var(--r-sm);
          font-size: 0.8125rem; font-weight: 500; color: var(--ink-2);
          text-decoration: none; text-align: left;
          transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease);
        }
        .account-item:hover { background: var(--surface-3); color: var(--ink); }
        .account-item-danger { color: var(--danger); }
        .account-item-danger:hover { background: var(--danger-soft); color: var(--danger); }
        @media (max-width: 767px) {
          .desktop-sidebar { display: none !important; }
          .mobile-menu-btn { display: inline-flex !important; }
        }
        @media (min-width: 768px) {
          .mobile-sidebar { display: none !important; }
          .mobile-menu-btn { display: none !important; }
          .mobile-close { display: none !important; }
        }
        @media (max-width: 480px) {
          .user-name { display: none; }
        }
      `}</style>
    </div>
  );
}
