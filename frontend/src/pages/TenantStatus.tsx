import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchTicket, fetchEvents } from '../lib/api';

interface Ticket {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  tenantName: string | null;
  rawSubject: string;
  classification: {
    category: string;
    urgency: string;
    description: string;
    estimatedCostMin: number;
    estimatedCostMax: number;
  } | null;
  assignedVendorId: string | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  paymentStatus: string;
  paymentAmount: number | null;
}

interface Event {
  id: string;
  timestamp: string;
  eventType: string;
  actor: string;
  description: string;
  data: Record<string, unknown>;
}

const STATUS_STEPS = [
  { key: 'NEW', label: 'Received', icon: '1' },
  { key: 'CLASSIFIED', label: 'Reviewed', icon: '2' },
  { key: 'VENDOR_CONTACTED', label: 'Vendor Assigned', icon: '3' },
  { key: 'SCHEDULED', label: 'Scheduled', icon: '4' },
  { key: 'PAYMENT_PENDING', label: 'Payment', icon: '5' },
  { key: 'COMPLETED', label: 'Completed', icon: '6' },
];

const STATUS_ORDER: Record<string, number> = {
  NEW: 0, CLASSIFIED: 1, PRIORITIZED: 1,
  VENDOR_SELECTED: 2, VENDOR_CONTACTED: 2, AWAITING_VENDOR_RESPONSE: 2,
  SCHEDULED: 3,
  PAYMENT_PENDING: 4, PAYMENT_COMPLETED: 5,
  COMPLETED: 5,
};

function getStepIndex(status: string): number {
  return STATUS_ORDER[status] ?? 0;
}

export function TenantStatus() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const [t, e] = await Promise.all([fetchTicket(id), fetchEvents(id)]);
        if (!t || t.error) { setError(true); return; }
        setTicket(t);
        setEvents(e.filter((ev: Event) => ev.ticketId === id));
      } catch { setError(true); }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [id]);

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-sm border p-8 text-center max-w-md">
        <div className="text-4xl mb-3">?</div>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">Ticket Not Found</h1>
        <p className="text-sm text-gray-500">This tracking link may be invalid or expired.</p>
      </div>
    </div>
  );

  if (!ticket) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400">Loading...</div>
    </div>
  );

  const currentStep = getStepIndex(ticket.status);
  const spongeTransferEvent = events.find(e => e.eventType === 'payment_transferred' && (e.data as any)?.method === 'sponge');
  const spongeCompleteEvent = events.find(e => e.eventType === 'payment_completed' && (e.data as any)?.method === 'sponge');
  const txHash = (spongeTransferEvent?.data as any)?.txHash;
  const chain = (spongeTransferEvent?.data as any)?.chain || 'solana';
  const explorerUrl = chain === 'solana' ? `https://solscan.io/tx/${txHash}` : `https://basescan.org/tx/${txHash}`;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <span className="text-2xl font-bold text-blue-600">Leakly</span>
          <p className="text-xs text-gray-500 mt-1">Maintenance Request Tracker</p>
        </div>

        {/* Greeting */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-4">
          <p className="text-sm text-gray-500 mb-1">Hi {ticket.tenantName || 'there'},</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">{ticket.rawSubject}</h1>
          <p className="text-xs text-gray-400">
            Submitted {new Date(ticket.createdAt).toLocaleDateString()} &middot; ID: {ticket.id.slice(0, 8)}
          </p>
        </div>

        {/* Progress Steps */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Status</h2>
          <div className="flex items-center justify-between">
            {STATUS_STEPS.map((step, i) => {
              const isComplete = i <= currentStep;
              const isCurrent = i === currentStep;
              return (
                <div key={step.key} className="flex flex-col items-center flex-1">
                  <div className="flex items-center w-full">
                    {i > 0 && (
                      <div className={`h-0.5 flex-1 ${i <= currentStep ? 'bg-blue-500' : 'bg-gray-200'}`} />
                    )}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      isComplete ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
                    } ${isCurrent ? 'ring-2 ring-blue-300 ring-offset-2' : ''}`}>
                      {isComplete && i < currentStep ? '\u2713' : step.icon}
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`h-0.5 flex-1 ${i < currentStep ? 'bg-blue-500' : 'bg-gray-200'}`} />
                    )}
                  </div>
                  <span className={`text-xs mt-2 ${isCurrent ? 'font-semibold text-blue-700' : 'text-gray-500'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {ticket.classification && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Issue</h3>
              <p className="text-sm font-medium text-gray-900 capitalize">{ticket.classification.category}</p>
              <p className="text-xs text-gray-500 mt-1">{ticket.classification.description}</p>
            </div>
          )}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Schedule</h3>
            {ticket.scheduledDate ? (
              <>
                <p className="text-sm font-medium text-gray-900">{ticket.scheduledDate}</p>
                <p className="text-xs text-gray-500 mt-1">{ticket.scheduledTimeSlot || 'Time TBD'}</p>
              </>
            ) : (
              <p className="text-sm text-gray-400">Not yet scheduled</p>
            )}
          </div>
        </div>

        {/* Payment Receipt */}
        {(spongeTransferEvent || spongeCompleteEvent) && (
          <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-purple-900">Payment Receipt</h3>
              {spongeCompleteEvent
                ? <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Paid</span>
                : <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">Processing</span>
              }
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Amount</span>
                <span className="font-medium">${ticket.paymentAmount ?? '—'} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Method</span>
                <span className="font-medium text-purple-700">Sponge (on-chain)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Network</span>
                <span className="font-medium capitalize">{chain}</span>
              </div>
              {txHash && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Proof</span>
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-blue-600 hover:underline"
                  >
                    View on {chain === 'solana' ? 'Solscan' : 'Basescan'} ↗
                  </a>
                </div>
              )}
              {spongeCompleteEvent && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Confirmed</span>
                  <span className="text-xs">{new Date(spongeCompleteEvent.timestamp).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Timeline (simplified) */}
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Updates</h3>
          <div className="space-y-3">
            {events
              .filter(e => !['memory_lookup', 'vendor_selected'].includes(e.eventType))
              .map(event => (
              <div key={event.id} className="flex gap-3 text-sm">
                <div className="w-16 shrink-0 text-xs text-gray-400">
                  {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="w-1.5 flex flex-col items-center">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 ${
                    event.eventType.includes('payment') ? 'bg-purple-400' :
                    event.eventType.includes('error') ? 'bg-red-400' :
                    'bg-blue-400'
                  }`} />
                  <div className="w-px flex-1 bg-gray-100 mt-1" />
                </div>
                <div className="flex-1 pb-3">
                  <p className="text-gray-700 text-sm">{friendlyDescription(event)}</p>
                  {(event.data as any)?.txHash && (
                    <a
                      href={((event.data as any)?.chain === 'solana' ? 'https://solscan.io/tx/' : 'https://basescan.org/tx/') + (event.data as any).txHash}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-1 text-xs font-mono text-blue-600 hover:underline bg-blue-50 px-2 py-0.5 rounded"
                    >
                      View transaction ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          This page updates automatically. Powered by Leakly.
        </p>
      </div>
    </div>
  );
}

/** Translate internal event descriptions to tenant-friendly language */
function friendlyDescription(event: Event): string {
  switch (event.eventType) {
    case 'ticket_created': return 'Your maintenance request was received.';
    case 'ai_classification': return `Issue identified: ${(event.data as any)?.classification?.category || 'maintenance'} repair needed.`;
    case 'vendor_contacted': return 'A repair vendor has been contacted.';
    case 'schedule_confirmed': return `Service visit scheduled${(event.data as any)?.confirmationNumber ? ` (Ref: ${(event.data as any).confirmationNumber})` : ''}.`;
    case 'payment_created': return 'Payment is being processed.';
    case 'payment_transferred': return 'Payment sent to vendor.';
    case 'payment_completed': return 'Payment confirmed. You\'re all set!';
    case 'email_sent':
      if (event.description?.includes('Tenant notified')) return 'We sent you an update email.';
      return event.description;
    case 'status_changed':
      if (event.description?.includes('browser')) return 'Booking the repair appointment...';
      if (event.description?.includes('Policy')) return 'Request is being reviewed.';
      return event.description;
    default: return event.description;
  }
}
