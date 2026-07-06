'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Zap, Phone, Loader2 } from '../../../components/icons';
import { simulatorApi } from '../../../lib/api';

interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  time: string;
  aiProcessed?: boolean;
  confidence?: number;
}

const QUICK_MESSAGES = [
  'Need 3 blue shirts size L',
  'Can I get 10 school uniforms for grade 8?',
  'I want 2 white shirts medium please',
  'Do you have black shirts in XL?',
  'Order status for #1024?',
];

export default function SimulatorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [phone, setPhone] = useState('+94771234567');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const messagesRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await simulatorApi.getMessages();
      const rawMessages = Array.isArray(res.data.data) ? res.data.data : res.data.data?.messages || [];
      const cleanPhone = phone.replace(/\s+/g, '');
      const formatted: ChatMessage[] = rawMessages
        .filter((msg: any) => msg.phone === cleanPhone)
        .map((msg: any) => ({
          id: msg.id,
          direction: msg.direction === 'INBOUND' ? 'inbound' : 'outbound',
          text: msg.messageText || msg.body || '',
          time: new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          aiProcessed: msg.direction === 'OUTBOUND' && (msg.messageText || msg.body || '').includes('Order ID'),
        }));
      formatted.sort((a, b) => a.id.localeCompare(b.id));
      setMessages(formatted);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [phone]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isProcessing]);

  const sendMessage = async (text?: string) => {
    const messageText = text ?? inputText;
    if (!messageText.trim() || isProcessing) return;

    const inbound: ChatMessage = {
      id: Date.now().toString(),
      direction: 'inbound',
      text: messageText,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, inbound]);
    setInputText('');
    setIsProcessing(true);

    try {
      await simulatorApi.sendMessage({ phone: phone.replace(/\s+/g, ''), message: messageText });
      setTimeout(() => {
        fetchMessages();
        setIsProcessing(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to send message:', err);
      setIsProcessing(false);
    }
  };

  return (
    <div className="page animate-fade-in">
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.6rem, 1.3rem + 1vw, 1.9rem)', fontWeight: 500 }}>WhatsApp Simulator</h1>
        <p className="t-muted" style={{ marginTop: 6 }}>Test the AI pipeline without a real WhatsApp Business account</p>
      </div>

      <div className="sim-grid">
        {/* Chat window */}
        <div className="glass-card stack" style={{ overflow: 'hidden', height: 580 }}>
          {/* Chat header */}
          <div className="row" style={{ padding: '13px 18px', background: 'var(--surface-1)', borderBottom: '1px solid var(--line)', gap: 11, flexShrink: 0 }}>
            <span className="row" style={{ width: 32, height: 32, borderRadius: '50%', background: '#25D366', justifyContent: 'center', flexShrink: 0 }}>
              <Phone size={15} color="#fff" />
            </span>
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{phone}</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--brand)' }}>● Online · Mock Mode</div>
            </div>
            <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
              <Zap size={13} color="var(--warning)" />
              <span className="t-muted" style={{ fontSize: '0.75rem' }}>AI Active</span>
            </div>
          </div>

          {/* Messages */}
          <div ref={messagesRef} className="stack" style={{ flex: 1, overflowY: 'auto', padding: 16, gap: 12, background: 'var(--bg)' }}>
            {isLoading && messages.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center' }}>
                <Loader2 size={22} color="var(--brand)" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 10px' }} />
                <div className="t-muted" style={{ fontSize: '0.75rem' }}>Loading messages...</div>
              </div>
            ) : messages.length === 0 ? (
              <div className="t-muted" style={{ margin: 'auto', textAlign: 'center' }}>No messages yet. Send a message to start.</div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="row" style={{ justifyContent: msg.direction === 'inbound' ? 'flex-start' : 'flex-end', alignItems: 'flex-end', gap: 8 }}>
                  {msg.direction === 'inbound' && (
                    <span className="row" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--violet-soft)', justifyContent: 'center', flexShrink: 0 }}>
                      <User size={12} color="var(--violet)" />
                    </span>
                  )}
                  <div style={{ maxWidth: '75%', padding: '9px 13px', borderRadius: msg.direction === 'inbound' ? '4px 14px 14px 14px' : '14px 4px 14px 14px', background: msg.direction === 'inbound' ? 'var(--surface-2)' : '#1f7a5c', color: msg.direction === 'inbound' ? 'var(--ink)' : '#fff', fontSize: '0.8125rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {msg.text}
                    <div style={{ fontSize: '0.625rem', marginTop: 4, opacity: 0.65, textAlign: msg.direction === 'outbound' ? 'right' : 'left' }}>
                      {msg.time}
                      {msg.aiProcessed && <span style={{ marginLeft: 6 }}><Bot size={9} style={{ display: 'inline', verticalAlign: 'middle' }} /> AI</span>}
                    </div>
                  </div>
                  {msg.direction === 'outbound' && (
                    <span className="row" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--brand-soft)', justifyContent: 'center', flexShrink: 0 }}>
                      <Bot size={12} color="var(--brand)" />
                    </span>
                  )}
                </div>
              ))
            )}

            {isProcessing && (
              <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'flex-end', gap: 8 }}>
                <div className="row" style={{ padding: '9px 15px', background: 'var(--surface-2)', borderRadius: '14px 4px 14px 14px', gap: 4 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand)', animation: `pulse-green 1s ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="row" style={{ padding: '11px 14px', borderTop: '1px solid var(--line)', gap: 8, flexShrink: 0 }}>
            <input
              className="input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a customer message..."
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-icon" onClick={() => sendMessage()} disabled={isProcessing} aria-label="Send message">
              {isProcessing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div className="stack" style={{ gap: 16 }}>
          <div className="glass-card" style={{ padding: 17 }}>
            <label className="stack" style={{ gap: 8 }}>
              Simulated customer phone
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+94 77 123 4567" />
            </label>
          </div>

          <div className="glass-card" style={{ padding: 17 }}>
            <h3 className="t-eyebrow" style={{ marginBottom: 11 }}>Quick Test Messages</h3>
            <div className="stack" style={{ gap: 6 }}>
              {QUICK_MESSAGES.map((msg) => (
                <button
                  key={msg}
                  onClick={() => sendMessage(msg)}
                  disabled={isProcessing}
                  className="quick-msg-btn"
                >
                  {msg}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: '13px 15px', background: 'var(--info-soft)', border: '1px solid var(--info)', borderRadius: 'var(--r-md)' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--info)', fontWeight: 600, marginBottom: 4 }}>Mock Mode Active</p>
            <p style={{ fontSize: '0.6875rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
              Messages go through the full AI pipeline. Check the Orders tab to see generated draft orders.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .sim-grid { display: grid; grid-template-columns: 1fr 280px; gap: 18px; }
        .quick-msg-btn {
          padding: 8px 12px; background: var(--surface-1); border: 1px solid var(--line);
          border-radius: var(--r-sm); color: var(--ink-2); font-size: 0.75rem; text-align: left;
          cursor: pointer; transition: all var(--dur-1) var(--ease); font-family: inherit;
        }
        .quick-msg-btn:hover { border-color: var(--brand-line); color: var(--ink); }
        @media (max-width: 860px) {
          .sim-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
