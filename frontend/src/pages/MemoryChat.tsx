import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { chatWithMemory } from '../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: { content: string; score?: number; metadata?: Record<string, unknown> }[];
}

const SUGGESTIONS = [
  "What recurring issues has unit 1a had?",
  "Which vendor has handled the most plumbing jobs?",
  "How much have we spent on repairs this month?",
  "Are there any units with repeat problems?",
  "What was the last issue reported by the tenant at unit 1a?",
];

export function MemoryChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');

    const userMsg: Message = { role: 'user', content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await chatWithMemory(msg);
      const assistantMsg: Message = {
        role: 'assistant',
        content: res.answer || 'Sorry, I couldn\'t find an answer.',
        sources: res.sources,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="text-3xl mb-3">🧠</div>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Maintenance Memory</h2>
              <p className="text-sm text-gray-500 mb-6">
                Ask questions about your maintenance history. Powered by Supermemory.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
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
              <div className={`max-w-lg rounded-xl px-4 py-3 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-400 mb-1">Sources from Supermemory:</p>
                    {msg.sources.map((s, j) => (
                      <div key={j} className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 mb-1">
                        {s.content.slice(0, 150)}{s.content.length > 150 ? '...' : ''}
                        {s.score != null && (
                          <span className="ml-1 text-gray-300">({(s.score * 100).toFixed(0)}% match)</span>
                        )}
                      </div>
                    ))}
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
            placeholder="Ask about maintenance history..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            disabled={loading}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
