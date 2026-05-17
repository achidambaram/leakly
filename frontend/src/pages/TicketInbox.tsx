import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchTickets, pollInbox } from '../lib/api';
import { useWebSocket } from '../lib/useWebSocket';
import { StatusBadge, UrgencyBadge } from '../components/StatusBadge';

interface Ticket {
  id: string;
  status: string;
  createdAt: string;
  tenantEmail: string;
  tenantName: string | null;
  rawSubject: string;
  classification: {
    category: string;
    urgency: string;
    urgencyScore: number;
    description: string;
    estimatedCostMax: number;
  } | null;
  assignedVendorId: string | null;
  scheduledDate: string | null;
  paymentStatus: string;
}

const STATUS_FILTERS = [
  'ALL', 'NEW', 'CLASSIFIED', 'VENDOR_CONTACTED', 'SCHEDULED',
  'PAYMENT_PENDING', 'COMPLETED', 'FAILED', 'REQUIRES_HUMAN_INTERVENTION',
];

export function TicketInbox() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [pollMsg, setPollMsg] = useState('');

  const loadTickets = useCallback(async () => {
    const data = await fetchTickets(filter === 'ALL' ? undefined : filter);
    setTickets(data);
    setLoading(false);
  }, [filter]);

  // Live updates via WebSocket
  useWebSocket(() => {
    loadTickets();
  });

  useEffect(() => {
    loadTickets();
    const interval = setInterval(loadTickets, 10000); // Fallback poll every 10s
    return () => clearInterval(interval);
  }, [loadTickets]);

  const handlePollInbox = async () => {
    setPolling(true);
    setPollMsg('');
    try {
      const result = await pollInbox();
      if (result.processed > 0) {
        setPollMsg(`Found ${result.processed} new email(s)! Processing...`);
        setTimeout(loadTickets, 3000);
      } else {
        setPollMsg('No new emails found.');
      }
    } catch {
      setPollMsg('Error checking inbox.');
    }
    setPolling(false);
  };

  const activeCount = tickets.filter(t => !['COMPLETED', 'CANCELLED', 'FAILED'].includes(t.status)).length;
  const needsAttention = tickets.filter(t => t.status === 'REQUIRES_HUMAN_INTERVENTION').length;

  return (
    <div>
      {/* Check Inbox Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-blue-800">
            Send a maintenance request to: <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs">frightenedcareer628@agentmail.to</code>
          </p>
          <p className="text-xs text-blue-600 mt-0.5">Send from Gmail or any email client, then click "Check Inbox" to pull it in.</p>
          {pollMsg && <p className="text-xs text-blue-700 mt-1 font-medium">{pollMsg}</p>}
        </div>
        <button
          onClick={handlePollInbox}
          disabled={polling}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {polling ? 'Checking...' : 'Check Inbox'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Tickets" value={tickets.length} />
        <StatCard label="Active" value={activeCount} color="text-blue-600" />
        <StatCard label="Needs Attention" value={needsAttention} color="text-red-600" />
        <StatCard label="Completed" value={tickets.filter(t => t.status === 'COMPLETED').length} color="text-green-600" />
      </div>

      {/* Filters */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              filter === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Ticket List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No tickets found</div>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <Link
              key={ticket.id}
              to={`/tickets/${ticket.id}`}
              className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={ticket.status} />
                    {ticket.classification && (
                      <UrgencyBadge urgency={ticket.classification.urgency} />
                    )}
                    {ticket.classification && (
                      <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                        {ticket.classification.category}
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-gray-900 truncate">
                    {ticket.rawSubject}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {ticket.tenantName || ticket.tenantEmail} &middot;{' '}
                    {new Date(ticket.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right text-xs text-gray-400 shrink-0">
                  {ticket.classification && (
                    <div className="text-gray-600 font-medium">
                      ${ticket.classification.estimatedCostMax}
                    </div>
                  )}
                  {ticket.scheduledDate && (
                    <div className="text-cyan-600">{ticket.scheduledDate}</div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
