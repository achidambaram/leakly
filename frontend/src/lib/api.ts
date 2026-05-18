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

export async function getVerifiedLinks() {
  const res = await fetch(`${BASE}/insights/verified-links`);
  return res.json();
}

export async function findLocalServices(category: string, recommendation: string) {
  const res = await fetch(`${BASE}/insights/find-services-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, recommendation }),
  });
  return res.json();
}

export async function runInsightsAnalysis() {
  const res = await fetch(`${BASE}/insights/analyze`, { method: 'POST' });
  return res.json();
}

export async function tenantChat(email: string, message: string, history: { role: string; content: string }[]) {
  const res = await fetch(`${BASE}/tenant-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, message, history }),
  });
  return res.json();
}

export async function chatWithMemory(message: string) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return res.json();
}

export async function fetchTicketsByEmail(email: string) {
  const res = await fetch(`${BASE}/tickets/by-email/${encodeURIComponent(email)}`);
  return res.json();
}

export async function bookViaPortal(ticketId: string) {
  const res = await fetch(`${BASE}/orchestrator/book-portal/${ticketId}`, { method: 'POST' });
  return res.json();
}

export async function spongePayTicket(ticketId: string) {
  const res = await fetch(`${BASE}/payments/sponge-pay/${ticketId}`, { method: 'POST' });
  return res.json();
}

export async function executeSpongePayment(paymentId: string) {
  const res = await fetch(`${BASE}/payments/${paymentId}/sponge-execute`, { method: 'POST' });
  return res.json();
}

export async function confirmSpongePayment(paymentId: string) {
  const res = await fetch(`${BASE}/payments/${paymentId}/sponge-confirm`, { method: 'POST' });
  return res.json();
}

export async function getSpongePaymentStatus(paymentId: string) {
  const res = await fetch(`${BASE}/payments/${paymentId}/sponge-status`);
  return res.json();
}
