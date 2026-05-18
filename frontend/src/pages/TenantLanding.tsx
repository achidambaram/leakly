import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { tenantChat, fetchTicketsByEmail } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  ticketCreated?: { id: string; subject: string; trackingUrl: string };
  memoryUsed?: boolean;
}

interface PastTicket {
  id: string;
  status: string;
  rawSubject: string;
  createdAt: string;
}

export function TenantLanding() {
  const [email, setEmail] = useState('');
  const [entered, setEntered] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pastTickets, setPastTickets] = useState<PastTicket[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const enterChat = async () => {
    if (!email.trim()) return;
    setEntered(true);
    // Load past tickets
    try {
      const tickets = await fetchTicketsByEmail(email.trim());
      if (Array.isArray(tickets)) setPastTickets(tickets.slice(0, 5));
    } catch { /* ignore */ }
  };

  const send = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');

    const userMsg: Message = { role: 'user', content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await tenantChat(email, msg, history);

      const assistantMsg: Message = {
        role: 'assistant',
        content: res.reply || "Sorry, I couldn't understand that.",
        ticketCreated: res.ticketCreated || undefined,
        memoryUsed: res.memoryUsed,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    }
    setLoading(false);
  };

  // Email entry screen
  if (!entered) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link to="/" className="text-2xl font-bold text-blue-600">Leakly</Link>
            <p className="text-sm text-gray-500 mt-1">Tenant Portal</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Report or Track an Issue</h2>
            <p className="text-xs text-gray-400 mb-4">Enter your email to chat with our AI maintenance assistant.</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                onKeyDown={(e) => e.key === 'Enter' && enterChat()}
              />
              <button
                onClick={enterChat}
                disabled={!email.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
          <div className="text-center mt-4">
            <Link to="/" className="text-xs text-gray-400 hover:text-gray-600">&larr; Back</Link>
          </div>
        </div>
      </div>
    );
  }

  // Chat interface
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 flex items-center justify-between h-12">
          <div className="flex items-center gap-2">
            <Link to="/" className="text-lg font-bold text-blue-600">Leakly</Link>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Tenant</span>
          </div>
          <span className="text-xs text-gray-400">{email}</span>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Welcome + past tickets */}
          {messages.length === 0 && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border p-4">
                <p className="text-sm text-gray-700">
                  Hi! I'm your maintenance assistant. Tell me about any issue in your unit and I'll get it handled.
                  I have access to your repair history so I can help faster.
                </p>
                {pastTickets.length > 0 && (
                  <p className="text-xs text-gray-400 mt-2">
                    I can see you have {pastTickets.length} past request{pastTickets.length > 1 ? 's' : ''} on file.
                  </p>
                )}
              </div>

              {pastTickets.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Your recent requests:</p>
                  <div className="space-y-2">
                    {pastTickets.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => navigate(`/track/${t.id}`)}
                        className="w-full bg-white rounded-lg border p-3 text-left hover:border-blue-300 transition-colors text-sm flex justify-between items-center"
                      >
                        <div>
                          <span className="text-gray-800 font-medium">{t.rawSubject}</span>
                          <span className="text-xs text-gray-400 ml-2">{new Date(t.createdAt).toLocaleDateString()}</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          t.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                          t.status === 'SCHEDULED' ? 'bg-indigo-100 text-indigo-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {t.status === 'COMPLETED' ? 'Done' : t.status === 'SCHEDULED' ? 'Scheduled' : 'In Progress'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {[
                  "My toilet won't stop running",
                  "There's a leak under my kitchen sink",
                  "My AC isn't cooling",
                  "A light switch stopped working",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:border-blue-300 hover:text-blue-700 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-md rounded-xl px-4 py-3 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>

                {msg.memoryUsed && msg.role === 'assistant' && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                    Used your maintenance history
                  </p>
                )}

                {msg.ticketCreated && (
                  <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-green-800 mb-1">Ticket Created</p>
                    <p className="text-xs text-green-700">{msg.ticketCreated.subject}</p>
                    <button
                      onClick={() => navigate(msg.ticketCreated!.trackingUrl)}
                      className="mt-2 text-xs bg-green-600 text-white px-3 py-1 rounded-md hover:bg-green-700 transition-colors"
                    >
                      Track Status &rarr;
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Describe your issue..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={loading}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
