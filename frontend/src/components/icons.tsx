'use client';

/**
 * CommercePilot custom icon set — hand-drawn, single-weight line icons.
 * Not sourced from any off-the-shelf icon package. Mirrors the prop
 * signature icon libraries typically use (size / color / strokeWidth)
 * so call sites read the same regardless of where the icon comes from.
 */

import type { CSSProperties } from 'react';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

type SvgProps = IconProps & { children: React.ReactNode };

function Svg({ size = 18, color = 'currentColor', strokeWidth = 1.75, style, className, children }: SvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function LayoutDashboard(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13" y="3.5" width="7.5" height="4.5" rx="1.6" />
      <rect x="13" y="10.5" width="7.5" height="10" rx="1.6" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="1.6" />
    </Svg>
  );
}

export function ShoppingCart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 4h2.2l1.1 11.2a1.8 1.8 0 0 0 1.8 1.6h8.6a1.8 1.8 0 0 0 1.78-1.55l1-6.65H6.1" />
      <circle cx="9.5" cy="20" r="1.35" />
      <circle cx="17" cy="20" r="1.35" />
    </Svg>
  );
}

export function Users(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.3" />
      <path d="M3.3 19c.5-3.2 2.9-5 5.7-5s5.2 1.8 5.7 5" />
      <circle cx="17.5" cy="8.5" r="2.5" />
      <path d="M15.3 14.2c2.35.24 4.15 1.9 4.55 4.35" />
    </Svg>
  );
}

export function User(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 19.5c.7-3.6 3.3-5.6 7.2-5.6s6.5 2 7.2 5.6" />
    </Svg>
  );
}

export function Package(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.2 20 7.3v9.4L12 20.8 4 16.7V7.3Z" />
      <path d="M4.3 7.4 12 11.3l7.7-3.9" />
      <path d="M12 11.3v9.4" />
      <path d="M8 5.3 16 9.2" />
    </Svg>
  );
}

export function MessageSquare(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5Z" />
    </Svg>
  );
}

export function MessageCircle(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4a8 8 0 1 0 5.6 13.7L21 19l-1.3-3.5A8 8 0 0 0 12 4Z" />
    </Svg>
  );
}

export function BarChart3(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20V10" />
      <path d="M12 20V4" />
      <path d="M20 20v-7" />
      <path d="M3 20.5h18" />
    </Svg>
  );
}

export function Settings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3" />
    </Svg>
  );
}

export function LogOut(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H9" />
      <path d="M14.5 16.5 19 12l-4.5-4.5" />
      <path d="M19 12H9" />
    </Svg>
  );
}

export function Bell(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5c-3 0-4.7 2.2-4.7 5.5 0 3.7-.9 5.1-2 6.2h13.4c-1.1-1.1-2-2.5-2-6.2 0-3.3-1.7-5.5-4.7-5.5Z" />
      <path d="M9.9 18.5a2.2 2.2 0 0 0 4.2 0" />
    </Svg>
  );
}

export function ChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 9 12 15.5 18.5 9" />
    </Svg>
  );
}

export function ChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 5.5 15.5 12 9 18.5" />
    </Svg>
  );
}

export function ChevronLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 5.5 8.5 12l6.5 6.5" />
    </Svg>
  );
}

export function Zap(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12.7 2.8 4.9 13.4h5.3l-1 7.8 7.9-10.7h-5.3Z" />
    </Svg>
  );
}

export function Menu(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
    </Svg>
  );
}

export function X(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />
    </Svg>
  );
}

export function Loader2(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
    </Svg>
  );
}

export function TrendingUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 16.5 9.8 10l4 4 6.2-7" />
      <path d="M15 6.5h5v5" />
    </Svg>
  );
}

export function ShoppingBag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.5 8h11l1 12H5.5Z" />
      <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
    </Svg>
  );
}

export function DollarSign(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.5v19" />
      <path d="M16.5 6.8c-.7-1-2-1.7-3.9-1.7-2.5 0-4.3 1.3-4.3 3.2 0 4 8.7 1.9 8.7 6.1 0 1.9-1.9 3.3-4.4 3.3-2.1 0-3.6-.8-4.4-1.9" />
    </Svg>
  );
}

export function Activity(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12.5h4l2.2-7 3.5 15 2.4-8h5.9" />
    </Svg>
  );
}

export function AlertCircle(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5" />
      <path d="M12 16.3v.1" />
    </Svg>
  );
}

export function RefreshCw(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5L19.5 8" />
      <path d="M19.5 4v4h-4" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.6 5.5L4.5 16" />
      <path d="M4.5 20v-4h4" />
    </Svg>
  );
}

export function Bot(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.5" y="8.5" width="15" height="10.5" rx="3" />
      <path d="M12 8.5V5.3" />
      <circle cx="12" cy="4" r="1.15" />
      <path d="M8.5 13.2v1.4M15.5 13.2v1.4" />
      <path d="M2.7 12v3M21.3 12v3" />
    </Svg>
  );
}

export function Search(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M20 20l-4.4-4.4" />
    </Svg>
  );
}

export function Phone(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.3 3.8h3.3l1.3 4.4-2.2 1.8a13 13 0 0 0 6.3 6.3l1.8-2.2 4.4 1.3v3.3c0 1-.9 1.8-1.9 1.6-4.3-.6-8.3-2.6-11.3-5.6S3.6 8 3 3.7c-.1-1 .7-1.9 1.6-1.9Z" />
    </Svg>
  );
}

export function ArrowLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 12H5" />
      <path d="M10.5 6 5 12l5.5 6" />
    </Svg>
  );
}

export function ArrowRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14" />
      <path d="M13.5 6 19 12l-5.5 6" />
    </Svg>
  );
}

export function Clock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.3V12l3.3 2" />
    </Svg>
  );
}

export function CheckCircle(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.3 12.3l2.5 2.5 5-5.2" />
    </Svg>
  );
}

export function XCircle(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </Svg>
  );
}

export function Filter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5h16l-6.2 7.4v5.4l-3.6 2v-7.4Z" />
    </Svg>
  );
}

export function Edit2(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4.2L19 9.2a2.3 2.3 0 0 0 0-3.3l-.9-.9a2.3 2.3 0 0 0-3.3 0L4 15.8Z" />
      <path d="M13.4 6.6l4 4" />
    </Svg>
  );
}

export function Trash2(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="M6.5 7l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10.2 11v6M13.8 11v6" />
    </Svg>
  );
}

export function Wallet(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 7.3A2.3 2.3 0 0 1 5.8 5h11.4a2.3 2.3 0 0 1 2.3 2.3v9.4a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3Z" />
      <path d="M14.8 13h3.3M3.5 9.8h17" />
    </Svg>
  );
}

export function Plus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function Database(p: IconProps) {
  return (
    <Svg {...p}>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
      <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </Svg>
  );
}

export function Building2(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 20.5V4.8A1.3 1.3 0 0 1 6.3 3.5h6.4a1.3 1.3 0 0 1 1.3 1.3v15.7" />
      <path d="M14 9.5h4.7A1.3 1.3 0 0 1 20 10.8v9.7" />
      <path d="M3 20.5h18" />
      <path d="M8 7h1.4M8 10.5h1.4M8 14h1.4M11.3 7h1.4M11.3 10.5h1.4M11.3 14h1.4M16.3 13h1.2M16.3 16.3h1.2" />
    </Svg>
  );
}

export function Key(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7.2" cy="14.8" r="3.8" />
      <path d="M9.9 12.1 17.8 4.2" />
      <path d="M14.6 7.5l2.3 2.3M17.6 4.5l2.3 2.3" />
    </Svg>
  );
}

export function Save(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 3.5h10.4L19.5 8v11.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
      <path d="M8 3.5V9h7V3.5" />
      <path d="M8 20v-5.5h8V20" />
    </Svg>
  );
}

export function ExternalLink(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.5 5.5h-4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
      <path d="M13.5 4.5H19.5v6" />
      <path d="M19 5l-8.5 8.5" />
    </Svg>
  );
}

export function Eye(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </Svg>
  );
}

export function EyeOff(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 3.5l17 17" />
      <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a13.4 13.4 0 0 1-3.4 4.1M7 7.8C4.4 9.5 2.5 12 2.5 12s3.5 6 9.5 6a8.9 8.9 0 0 0 2.9-.5" />
      <path d="M9.7 13.7a2.6 2.6 0 0 0 3.6-3.6" />
    </Svg>
  );
}

export function Send(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4.5 20 12 4 19.5l2.2-6.3L4 4.5Z" />
      <path d="M6.2 13.2H13" />
    </Svg>
  );
}

export function Mail(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5.5" width="18" height="13" rx="1.8" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </Svg>
  );
}

export function Lock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.8" />
      <path d="M7.5 10.5V7.8a4.5 4.5 0 0 1 9 0v2.7" />
    </Svg>
  );
}

export function Sun(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.3M12 19.2v2.3M4.3 4.3l1.6 1.6M18.1 18.1l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.3 19.7l1.6-1.6M18.1 5.9l1.6-1.6" />
    </Svg>
  );
}

export function Moon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 13.4A8 8 0 0 1 10.6 4a0.6 0.6 0 0 0-.8-.7 8.8 8.8 0 1 0 10.9 10.9.6.6 0 0 0-.7-.8Z" />
    </Svg>
  );
}

export function Check(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  );
}

export function Sparkles(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.2 13.7 8.3 18.8 10 13.7 11.7 12 16.8 10.3 11.7 5.2 10 10.3 8.3Z" />
      <path d="M18.5 4v3M20 5.5h-3M5.5 16v2.6M6.8 17.3H4.2" />
    </Svg>
  );
}

export function Inbox(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 13.5 6.3 5.4A2 2 0 0 1 8.2 4h7.6a2 2 0 0 1 1.9 1.4L20 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M4 13.5h4.2a1 1 0 0 1 .9.6 3 3 0 0 0 5.8 0 1 1 0 0 1 .9-.6H20" />
    </Svg>
  );
}
