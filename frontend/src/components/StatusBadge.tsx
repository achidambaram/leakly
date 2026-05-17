const statusConfig: Record<string, { color: string; label: string }> = {
  NEW: { color: 'bg-gray-100 text-gray-700', label: 'New' },
  CLASSIFIED: { color: 'bg-blue-100 text-blue-700', label: 'Classified' },
  PRIORITIZED: { color: 'bg-indigo-100 text-indigo-700', label: 'Prioritized' },
  VENDOR_SELECTED: { color: 'bg-purple-100 text-purple-700', label: 'Vendor Selected' },
  VENDOR_CONTACTED: { color: 'bg-yellow-100 text-yellow-800', label: 'Vendor Contacted' },
  AWAITING_VENDOR_RESPONSE: { color: 'bg-yellow-100 text-yellow-800', label: 'Awaiting Response' },
  SCHEDULED: { color: 'bg-cyan-100 text-cyan-700', label: 'Scheduled' },
  PAYMENT_PENDING: { color: 'bg-orange-100 text-orange-700', label: 'Payment Pending' },
  PAYMENT_COMPLETED: { color: 'bg-emerald-100 text-emerald-700', label: 'Payment Done' },
  COMPLETED: { color: 'bg-green-100 text-green-700', label: 'Completed' },
  FAILED: { color: 'bg-red-100 text-red-700', label: 'Failed' },
  REQUIRES_HUMAN_INTERVENTION: { color: 'bg-red-100 text-red-700', label: 'Needs Human' },
  CANCELLED: { color: 'bg-gray-100 text-gray-500', label: 'Cancelled' },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { color: 'bg-gray-100 text-gray-600', label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}

const urgencyConfig: Record<string, { color: string; dot: string }> = {
  emergency: { color: 'text-red-600', dot: 'bg-red-500' },
  high: { color: 'text-orange-600', dot: 'bg-orange-500' },
  medium: { color: 'text-yellow-600', dot: 'bg-yellow-500' },
  low: { color: 'text-gray-500', dot: 'bg-gray-400' },
};

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const config = urgencyConfig[urgency] || { color: 'text-gray-500', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${config.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {urgency}
    </span>
  );
}
