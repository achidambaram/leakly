import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchTicket, fetchEvents, approvePayment, simulatePayment, sendVendorReply, bookViaPortal, spongePayTicket } from '../lib/api';
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
  const [bookingPortal, setBookingPortal] = useState(false);

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
      <Link to="/dashboard" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
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

      {/* Supermemory Context */}
      {(() => {
        const memEvent = events.find(e => e.eventType === 'memory_lookup');
        if (!memEvent) return null;
        const data = memEvent.data as any;
        const unitHistory = data?.unitHistory || [];
        const tenantHistory = data?.tenantHistory || [];
        const hasContext = unitHistory.length > 0 || tenantHistory.length > 0;

        return (
          <div className={`border rounded-lg p-4 mb-4 ${hasContext ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
            <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
              Supermemory Context
              {hasContext
                ? <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Prior history found</span>
                : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">First-time request</span>
              }
            </h3>
            {hasContext ? (
              <div className="space-y-2 text-sm">
                {unitHistory.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">Past issues at this unit:</p>
                    {unitHistory.map((item: string, i: number) => (
                      <p key={i} className="text-xs text-gray-700 bg-white rounded px-2 py-1 mb-1 border border-amber-100">{item}</p>
                    ))}
                  </div>
                )}
                {tenantHistory.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">Tenant history:</p>
                    {tenantHistory.map((item: string, i: number) => (
                      <p key={i} className="text-xs text-gray-700 bg-white rounded px-2 py-1 mb-1 border border-amber-100">{item}</p>
                    ))}
                  </div>
                )}
                <p className="text-xs text-amber-600 italic mt-1">This context was included in the vendor briefing email.</p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">No prior maintenance history for this unit or tenant. Context will be saved after resolution.</p>
            )}
          </div>
        );
      })()}

      {/* Sponge Payment Receipt */}
      {(() => {
        const spongeTransferEvent = events.find(e => e.eventType === 'payment_transferred' && (e.data as any)?.method === 'sponge');
        const spongeCompleteEvent = events.find(e => e.eventType === 'payment_completed' && (e.data as any)?.method === 'sponge');
        const spongeQueuedEvent = events.find(e => e.eventType === 'payment_created' && (e.data as any)?.method === 'sponge');
        const txHash = (spongeTransferEvent?.data as any)?.txHash;
        const chain = (spongeTransferEvent?.data as any)?.chain || (spongeQueuedEvent?.data as any)?.chain || 'solana';
        const vendorWallet = (spongeQueuedEvent?.data as any)?.vendorWallet;
        const amount = (spongeQueuedEvent?.data as any)?.amount;

        if (!spongeQueuedEvent && !spongeTransferEvent && !spongeCompleteEvent) return null;

        const explorerUrl = chain === 'solana'
          ? `https://solscan.io/tx/${txHash}`
          : `https://basescan.org/tx/${txHash}`;

        return (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-purple-900 mb-3 flex items-center gap-2">
              Sponge Payment Receipt
              {spongeCompleteEvent && <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Confirmed</span>}
              {!spongeCompleteEvent && spongeTransferEvent && <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">Transferred</span>}
              {!spongeCompleteEvent && !spongeTransferEvent && <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">Pending</span>}
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Method</span>
                <span className="font-medium text-purple-800">USDC via Sponge</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Chain</span>
                <span className="font-medium">{chain}</span>
              </div>
              {amount != null && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Amount</span>
                  <span className="font-medium">${(amount / 100).toFixed(2)} USDC</span>
                </div>
              )}
              {vendorWallet && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Vendor Wallet</span>
                  <span className="font-mono text-xs text-gray-700">{vendorWallet.slice(0, 8)}...{vendorWallet.slice(-6)}</span>
                </div>
              )}
              {txHash && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Transaction</span>
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-blue-600 hover:underline"
                  >
                    {txHash.slice(0, 12)}...{txHash.slice(-8)} ↗
                  </a>
                </div>
              )}
              {spongeCompleteEvent && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Confirmed At</span>
                  <span className="text-xs text-gray-700">{new Date(spongeCompleteEvent.timestamp).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Sponge USDC Live View */}
      {(() => {
        const transferEvent = [...events].reverse().find(e => e.eventType === 'payment_transferred' && (e.data as any)?.method === 'sponge');
        const queuedEvent = [...events].reverse().find(e => e.eventType === 'payment_created' && (e.data as any)?.method === 'sponge');
        const completedEvent = events.find(e => e.eventType === 'payment_completed' && (e.data as any)?.method === 'sponge');
        const txHash = (transferEvent?.data as any)?.txHash;
        const chain = (transferEvent?.data as any)?.chain || (queuedEvent?.data as any)?.chain || 'solana';
        const vendorWallet = (queuedEvent?.data as any)?.vendorWallet;
        const isPending = ticket.paymentStatus === 'sponge_pending' || ticket.paymentStatus === 'sponge_transferred';

        if (!queuedEvent && !transferEvent) return null;

        const explorerTxUrl = chain === 'solana'
          ? `https://solscan.io/tx/${txHash}`
          : `https://basescan.org/tx/${txHash}`;
        const explorerWalletUrl = chain === 'solana'
          ? `https://solscan.io/account/${vendorWallet}`
          : `https://basescan.org/address/${vendorWallet}`;

        return (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-purple-900 flex items-center gap-2">
                Sponge USDC Payment
                {isPending && !txHash && (
                  <>
                    <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                    <span className="text-xs font-normal text-yellow-700">Queued</span>
                  </>
                )}
                {isPending && txHash && (
                  <>
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-xs font-normal text-green-700">Confirming on-chain</span>
                  </>
                )}
                {completedEvent && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-normal">Confirmed</span>
                )}
              </h3>
              {txHash && (
                <a
                  href={explorerTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-600 hover:underline"
                >
                  View on {chain === 'solana' ? 'Solscan' : 'Basescan'} ↗
                </a>
              )}
            </div>

            {/* Transaction details */}
            <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
              <div className="bg-white rounded p-2 border border-purple-100">
                <span className="text-gray-500 block">Chain</span>
                <span className="font-semibold text-purple-800 capitalize">{chain}</span>
              </div>
              <div className="bg-white rounded p-2 border border-purple-100">
                <span className="text-gray-500 block">Token</span>
                <span className="font-semibold text-purple-800">USDC</span>
              </div>
              <div className="bg-white rounded p-2 border border-purple-100">
                <span className="text-gray-500 block">Amount</span>
                <span className="font-semibold text-purple-800">${ticket.paymentAmount ?? '—'}</span>
              </div>
            </div>

            {vendorWallet && (
              <div className="text-xs mb-3 bg-white rounded p-2 border border-purple-100 flex justify-between items-center">
                <span className="text-gray-500">Vendor Wallet</span>
                <a href={explorerWalletUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-purple-700 hover:underline">
                  {vendorWallet.slice(0, 6)}...{vendorWallet.slice(-6)} ↗
                </a>
              </div>
            )}

            {txHash && (
              <div className="text-xs mb-3 bg-white rounded p-2 border border-purple-100 flex justify-between items-center">
                <span className="text-gray-500">Transaction</span>
                <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 hover:underline">
                  {txHash.slice(0, 12)}...{txHash.slice(-8)} ↗
                </a>
              </div>
            )}

            {/* Embedded explorer view */}
            {txHash && (
              <div className="rounded-md overflow-hidden border border-purple-300 bg-white">
                <iframe
                  src={explorerTxUrl}
                  className="w-full"
                  style={{ height: '400px' }}
                  title="Sponge USDC Transaction"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            )}

            {!txHash && isPending && (
              <div className="flex items-center justify-center py-8 bg-white rounded border border-purple-100">
                <div className="text-center">
                  <div className="w-8 h-8 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-sm text-purple-600">Waiting for USDC transfer to be submitted...</p>
                </div>
              </div>
            )}

            {completedEvent && (
              <p className="text-xs text-green-600 mt-2">
                Payment confirmed at {new Date(completedEvent.timestamp).toLocaleString()}
              </p>
            )}
          </div>
        );
      })()}

      {/* Browser Use Live View */}
      {(() => {
        const browserEvent = [...events].reverse().find(e => (e.data as any)?.liveUrl && (e.data as any)?.method === 'browser_use');
        const liveUrl = (browserEvent?.data as any)?.liveUrl;
        const isActive = ticket.status === 'VENDOR_CONTACTED' || ticket.status === 'AWAITING_VENDOR_RESPONSE';
        if (!liveUrl) return null;

        return (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
                Browser Automation
                {isActive && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                {isActive ? ' Live' : ''}
              </h3>
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-600 hover:underline"
              >
                Open in new tab ↗
              </a>
            </div>
            <div className="rounded-md overflow-hidden border border-indigo-300 bg-white">
              <iframe
                src={liveUrl}
                className="w-full"
                style={{ height: '400px' }}
                title="Browser Use Live View"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
            <p className="text-xs text-indigo-500 mt-2">
              {isActive ? 'Watching the AI agent fill out the vendor booking form in real-time.' : 'Browser session has ended.'}
            </p>
          </div>
        );
      })()}

      {/* Vendor Reply (when waiting for vendor response) */}
      {(ticket.status === 'VENDOR_CONTACTED' || ticket.status === 'AWAITING_VENDOR_RESPONSE') && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-orange-800 mb-2">Reply as Vendor</h3>
          <p className="text-xs text-orange-600 mb-2">
            Reply as the vendor, or use Browser Use to auto-book through their portal.
          </p>
          <button
            onClick={async () => {
              setBookingPortal(true);
              setActionMsg('');
              try {
                const res = await bookViaPortal(ticket.id);
                setActionMsg(res.message || 'Browser automation started!');
                setTimeout(load, 8000);
              } catch {
                setActionMsg('Failed to start browser automation.');
              }
              setBookingPortal(false);
            }}
            disabled={bookingPortal}
            className="mb-3 px-4 py-2 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {bookingPortal ? 'Launching browser...' : 'Book via Vendor Portal (Browser Use)'}
          </button>
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
      {(ticket.policyDecision === 'pending_approval' || ticket.paymentStatus === 'link_sent' || ticket.paymentStatus === 'sponge_pending' || (ticket.status === 'SCHEDULED' && ticket.paymentStatus === 'none')) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-yellow-800 mb-2">Payment Actions</h3>
          <div className="flex gap-2 flex-wrap">
            {ticket.policyDecision === 'pending_approval' && ticket.status === 'SCHEDULED' && (
              <button
                onClick={handleApprove}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 transition-colors"
              >
                Approve Payment (${ticket.classification?.estimatedCostMax})
              </button>
            )}
            {(ticket.status === 'SCHEDULED' || ticket.paymentStatus === 'link_sent') && ticket.paymentStatus !== 'sponge_pending' && (
              <button
                onClick={async () => {
                  setActionMsg('Initiating Sponge USDC payment...');
                  try {
                    const res = await spongePayTicket(ticket.id);
                    if (res.error) {
                      setActionMsg(`Error: ${res.error}`);
                    } else {
                      setActionMsg(`Sponge payment queued: $${res.transfer.amount} USDC → ${res.transfer.to} (${res.transfer.chain})`);
                      load();
                    }
                  } catch {
                    setActionMsg('Failed to initiate Sponge payment');
                  }
                }}
                className="px-4 py-2 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 transition-colors"
              >
                Pay Vendor via Sponge (USDC)
              </button>
            )}
            {ticket.paymentStatus === 'link_sent' && (
              <button
                onClick={handleSimulatePay}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
              >
                Simulate Stripe Payment
              </button>
            )}
            {ticket.paymentStatus === 'sponge_pending' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full">
                <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                Sponge USDC transfer pending — waiting for on-chain confirmation
              </span>
            )}
            {ticket.paymentStatus === 'sponge_transferred' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                USDC transferred on-chain — confirming...
              </span>
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
                {(event.data as any)?.txHash && (
                  <a
                    href={((event.data as any)?.chain === 'solana' ? 'https://solscan.io/tx/' : 'https://basescan.org/tx/') + (event.data as any).txHash}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-xs font-mono text-blue-600 hover:underline bg-blue-50 px-2 py-0.5 rounded"
                  >
                    tx: {(event.data as any).txHash.slice(0, 16)}... ↗
                  </a>
                )}
                {(event.data as any)?.liveUrl && (
                  <a
                    href={(event.data as any).liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-xs text-indigo-600 hover:underline bg-indigo-50 px-2 py-0.5 rounded"
                  >
                    Watch browser session ↗
                  </a>
                )}
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
