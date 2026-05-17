import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchTicket, fetchEvents, approvePayment, simulatePayment, sendVendorReply } from '../lib/api';
import { StatusBadge, UrgencyBadge } from '../components/StatusBadge';

interface Ticket {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  tenantEmail: string;
  tenantName: string | null;
  propertyUnitId: string;
  rawSubject: string;
  rawBody: string;
  classification: {
    category: string;
    urgency: string;
    urgencyScore: number;
    estimatedCostMin: number;
    estimatedCostMax: number;
    description: string;
    confidence: number;
    recommendedAction: string;
  } | null;
  assignedVendorId: string | null;
  vendorContactedAt: string | null;
  vendorRespondedAt: string | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  paymentStatus: string;
  paymentAmount: number | null;
  paymentIntentId: string | null;
  policyDecision: string | null;
  retryCount: number;
  failureReason: string | null;
}

interface Event {
  id: string;
  ticketId: string;
  timestamp: string;
  eventType: string;
  actor: string;
  description: string;
  data: Record<string, unknown>;
}

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [actionMsg, setActionMsg] = useState('');
  const [vendorReply, setVendorReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const load = async () => {
    if (!id) return;
    const [t, e] = await Promise.all([fetchTicket(id), fetchEvents(id)]);
    setTicket(t);
    setEvents(e.filter((ev: Event) => ev.ticketId === id));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [id]);

  if (!ticket) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  const handleApprove = async () => {
    const res = await approvePayment(ticket.id);
    setActionMsg(`Approved! Payment link: ${res.payment?.url || 'created'}`);
    load();
  };

  const handleSimulatePay = async () => {
    // Find payment ID from events
    const payEvent = events.find(e => e.eventType === 'payment_created');
    const payId = (payEvent?.data as any)?.paymentId;
    if (payId) {
      await simulatePayment(payId);
      setActionMsg('Payment simulated! Ticket completed.');
      load();
    }
  };

  return (
    <div>
      <Link to="/" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
        &larr; Back to tickets
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge status={ticket.status} />
              {ticket.classification && <UrgencyBadge urgency={ticket.classification.urgency} />}
              {ticket.classification && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{ticket.classification.category}</span>
              )}
            </div>
            <h1 className="text-lg font-semibold text-gray-900">{ticket.rawSubject}</h1>
            <p className="text-sm text-gray-500 mt-1">
              From: {ticket.tenantName || ticket.tenantEmail} &middot; Unit: {ticket.propertyUnitId}
            </p>
          </div>
          <div className="text-right text-xs text-gray-400">
            <div>Created: {new Date(ticket.createdAt).toLocaleString()}</div>
            <div>Updated: {new Date(ticket.updatedAt).toLocaleString()}</div>
          </div>
        </div>

        {/* Original message */}
        <div className="mt-4 p-3 bg-gray-50 rounded-md text-sm text-gray-700 whitespace-pre-wrap">
          {ticket.rawBody}
        </div>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Classification */}
        {ticket.classification && (
          <InfoCard title="AI Classification">
            <InfoRow label="Category" value={ticket.classification.category} />
            <InfoRow label="Urgency" value={`${ticket.classification.urgency} (${(ticket.classification.urgencyScore * 100).toFixed(0)}%)`} />
            <InfoRow label="Cost Estimate" value={`$${ticket.classification.estimatedCostMin} - $${ticket.classification.estimatedCostMax}`} />
            <InfoRow label="Confidence" value={`${(ticket.classification.confidence * 100).toFixed(0)}%`} />
            <p className="text-xs text-gray-500 mt-2 italic">{ticket.classification.recommendedAction}</p>
          </InfoCard>
        )}

        {/* Vendor & Scheduling */}
        <InfoCard title="Vendor & Schedule">
          <InfoRow label="Vendor" value={ticket.assignedVendorId || 'Not assigned'} />
          <InfoRow label="Contacted" value={ticket.vendorContactedAt ? new Date(ticket.vendorContactedAt).toLocaleString() : 'N/A'} />
          <InfoRow label="Responded" value={ticket.vendorRespondedAt ? new Date(ticket.vendorRespondedAt).toLocaleString() : 'N/A'} />
          <InfoRow label="Scheduled" value={ticket.scheduledDate ? `${ticket.scheduledDate} ${ticket.scheduledTimeSlot || ''}` : 'N/A'} />
        </InfoCard>

        {/* Payment */}
        <InfoCard title="Payment">
          <InfoRow label="Status" value={ticket.paymentStatus} />
          <InfoRow label="Amount" value={ticket.paymentAmount ? `$${ticket.paymentAmount}` : 'N/A'} />
          <InfoRow label="Policy" value={ticket.policyDecision || 'N/A'} />
          {ticket.failureReason && (
            <p className="text-xs text-red-600 mt-2">{ticket.failureReason}</p>
          )}
        </InfoCard>
      </div>

      {/* Vendor Reply (when waiting for vendor response) */}
      {(ticket.status === 'VENDOR_CONTACTED' || ticket.status === 'AWAITING_VENDOR_RESPONSE') && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-orange-800 mb-2">Reply as Vendor</h3>
          <p className="text-xs text-orange-600 mb-2">
            Type a reply as if you're the assigned vendor. Examples: "Sure, I can come tomorrow at 2pm",
            "Sorry, I'm fully booked this week", "Can we do Thursday instead?"
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={vendorReply}
              onChange={(e) => setVendorReply(e.target.value)}
              placeholder="Type vendor reply..."
              className="flex-1 px-3 py-2 border border-orange-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && vendorReply.trim()) {
                  setSendingReply(true);
                  sendVendorReply(ticket.id, vendorReply).then(() => {
                    setActionMsg('Vendor reply sent! Processing...');
                    setVendorReply('');
                    setSendingReply(false);
                    setTimeout(load, 5000);
                  });
                }
              }}
            />
            <button
              onClick={() => {
                if (!vendorReply.trim()) return;
                setSendingReply(true);
                sendVendorReply(ticket.id, vendorReply).then(() => {
                  setActionMsg('Vendor reply sent! Processing...');
                  setVendorReply('');
                  setSendingReply(false);
                  setTimeout(load, 5000);
                });
              }}
              disabled={sendingReply || !vendorReply.trim()}
              className="px-4 py-2 bg-orange-600 text-white text-sm rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors"
            >
              {sendingReply ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {(ticket.policyDecision === 'pending_approval' || ticket.paymentStatus === 'link_sent') && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-yellow-800 mb-2">Property Manager Actions</h3>
          <div className="flex gap-2">
            {ticket.policyDecision === 'pending_approval' && ticket.status === 'SCHEDULED' && (
              <button
                onClick={handleApprove}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 transition-colors"
              >
                Approve Payment (${ticket.classification?.estimatedCostMax})
              </button>
            )}
            {ticket.paymentStatus === 'link_sent' && (
              <button
                onClick={handleSimulatePay}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
              >
                Simulate Payment
              </button>
            )}
          </div>
          {actionMsg && <p className="text-xs text-green-700 mt-2">{actionMsg}</p>}
        </div>
      )}

      {/* Event Timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Event Timeline</h2>
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="flex gap-3 text-sm">
              <div className="w-20 shrink-0 text-xs text-gray-400">
                {new Date(event.timestamp).toLocaleTimeString()}
              </div>
              <div className="w-2 flex flex-col items-center">
                <div className={`w-2 h-2 rounded-full mt-1 ${actorColor(event.actor)}`} />
                <div className="w-px flex-1 bg-gray-200 mt-1" />
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-400 uppercase">{event.actor}</span>
                  <span className="text-xs text-gray-300">{event.eventType.replace(/_/g, ' ')}</span>
                </div>
                <p className="text-gray-700 text-sm">{event.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  );
}

function actorColor(actor: string): string {
  switch (actor) {
    case 'ai': return 'bg-purple-400';
    case 'system': return 'bg-blue-400';
    case 'tenant': return 'bg-green-400';
    case 'vendor': return 'bg-orange-400';
    case 'property_manager': return 'bg-yellow-400';
    default: return 'bg-gray-400';
  }
}
