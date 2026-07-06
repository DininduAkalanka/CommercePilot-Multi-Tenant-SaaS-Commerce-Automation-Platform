'use client';

import { useState, useEffect, useRef } from 'react';
import { AlertCircle, Loader2, X } from './icons';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  loading?: boolean;
  /** When true, shows a reason field; onConfirm receives its trimmed value. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** Confirm stays disabled until the reason is non-empty. */
  reasonRequired?: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

/**
 * A single professional confirmation / reason-prompt dialog used everywhere
 * a native window.confirm()/prompt() would otherwise appear. Themed, animated,
 * keyboard-accessible (Esc to cancel, Enter to confirm), and fully responsive.
 */
export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  requireReason = false,
  reasonLabel,
  reasonPlaceholder = 'Add a note…',
  reasonRequired = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset the field each time the dialog opens and focus it.
  useEffect(() => {
    if (open) {
      setReason('');
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Esc closes the dialog while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const confirmDisabled = loading || (requireReason && reasonRequired && !reason.trim());
  const accent = tone === 'danger' ? 'var(--danger)' : 'var(--brand)';

  const submit = () => {
    if (confirmDisabled) return;
    onConfirm(requireReason ? reason.trim() : undefined);
  };

  return (
    <div className="modal-overlay" onClick={() => !loading && onCancel()}>
      <div
        className="modal-content"
        style={{ maxWidth: 460 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ alignItems: 'flex-start', gap: 14, marginBottom: description || requireReason ? 18 : 22 }}>
          <span
            className="row"
            style={{
              width: 40, height: 40, borderRadius: 'var(--r-md)', flexShrink: 0, justifyContent: 'center',
              background: tone === 'danger' ? 'var(--danger-soft)' : 'var(--brand-soft)', color: accent,
            }}
          >
            <AlertCircle size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <h2 style={{ fontSize: '1.0625rem', fontWeight: 650, letterSpacing: '-0.01em' }}>{title}</h2>
            {description && <p className="t-muted" style={{ marginTop: 5, lineHeight: 1.5 }}>{description}</p>}
          </div>
          <button
            className="btn btn-ghost btn-icon"
            style={{ width: 30, height: 30, border: 'none', flexShrink: 0 }}
            onClick={onCancel}
            disabled={loading}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {requireReason && (
          <label className="stack" style={{ gap: 6, marginBottom: 22 }}>
            {reasonLabel && <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--ink-2)' }}>{reasonLabel}</span>}
            <textarea
              ref={inputRef}
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder={reasonPlaceholder}
              style={{ minHeight: 80 }}
            />
          </label>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            className={tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={submit}
            disabled={confirmDisabled}
          >
            {loading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
