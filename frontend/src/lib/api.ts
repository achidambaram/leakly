const BASE = '/api';

export async function fetchTickets(status?: string) {
  const params = status ? `?status=${status}` : '';
  const res = await fetch(`${BASE}/tickets${params}`);
  return res.json();
}

export async function fetchTicket(id: string) {
  const res = await fetch(`${BASE}/tickets/${id}`);
  return res.json();
}

export async function fetchEvents(ticketId?: string) {
  const params = ticketId ? `?ticketId=${ticketId}` : '';
  const res = await fetch(`${BASE}/events${params}`);
  return res.json();
}

export async function fetchVendors() {
  const res = await fetch(`${BASE}/vendors`);
  return res.json();
}

export async function approvePayment(ticketId: string) {
  const res = await fetch(`${BASE}/payments/tickets/${ticketId}/approve-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy: 'dashboard_user' }),
  });
  return res.json();
}

export async function processTicket(ticketId: string) {
  const res = await fetch(`${BASE}/orchestrator/process/${ticketId}`, { method: 'POST' });
  return res.json();
}

export async function simulatePayment(paymentId: string) {
  const res = await fetch(`${BASE}/payments/${paymentId}/simulate-pay`, { method: 'POST' });
  return res.json();
}

export async function pollInbox() {
  const res = await fetch(`${BASE}/webhooks/poll-inbox`, { method: 'POST' });
  return res.json();
}

export async function sendVendorReply(ticketId: string, message: string) {
  const res = await fetch(`${BASE}/webhooks/vendor-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId, message }),
  });
  return res.json();
}
