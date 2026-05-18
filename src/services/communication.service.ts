/**
 * Communication Service — AgentMail SDK integration
 * Handles all email I/O: creating inboxes, sending vendor requests, tenant notifications.
 */

import { AgentMailClient } from "agentmail";

const client = new AgentMailClient({
  apiKey: process.env.AGENTMAIL_API_KEY!,
});

interface SendEmailParams {
  to: string;
  from: string; // inbox email address (used as inboxId)
  subject: string;
  body: string;
  threadId?: string;
}

interface SendResult {
  messageId: string;
  threadId: string;
}

interface InboxInfo {
  id: string;
  email: string;
  name?: string;
}

// Email templates
const templates = {
  vendorRequest(params: {
    vendorName: string;
    category: string;
    description: string;
    address: string;
    urgency: string;
    pastContext?: string;
  }): { subject: string; body: string } {
    const historySection = params.pastContext
      ? `\n\nPrior History (from our records):\n${params.pastContext}\n`
      : "";

    return {
      subject: `Maintenance Request — ${params.category} issue at ${params.address}`,
      body: `Hi ${params.vendorName},

We have a ${params.urgency}-priority ${params.category} maintenance request:

${params.description}

Location: ${params.address}${historySection}

Are you available to handle this? Please reply with your earliest availability.

Thanks,
Leakly Property Management`,
    };
  },

  tenantConfirmation(params: {
    tenantName: string;
    vendorName: string;
    category: string;
    ticketId?: string;
    scheduledDate?: string;
    scheduledTime?: string;
  }): { subject: string; body: string } {
    const scheduleInfo =
      params.scheduledDate && params.scheduledTime
        ? `\n\nScheduled: ${params.scheduledDate} at ${params.scheduledTime}`
        : "\n\nWe'll notify you once a time is confirmed.";

    return {
      subject: `Your ${params.category} repair — vendor assigned`,
      body: `Hi ${params.tenantName || "there"},

Good news! We've assigned ${params.vendorName} to handle your ${params.category} issue.${scheduleInfo}

Track your request in real-time: ${process.env.BASE_URL || "http://localhost:5173"}/track/${params.ticketId || ""}

— Leakly Property Management`,
    };
  },

  tenantAvailabilityRequest(params: {
    tenantName: string;
    vendorName: string;
    category: string;
    address: string;
    ticketId?: string;
  }): { subject: string; body: string } {
    return {
      subject: `Your ${params.category} repair — when works for you?`,
      body: `Hi ${params.tenantName || "there"},

Good news! We've assigned ${params.vendorName} to handle your ${params.category} issue at ${params.address}.

To schedule the appointment, please reply with your preferred date(s) and time(s). For example:
  - "Tuesday or Wednesday morning works best"
  - "Any day this week after 2 PM"
  - "May 20th between 10 AM and 2 PM"

The sooner you reply, the sooner we can get this fixed!

Track your request: ${process.env.BASE_URL || "http://localhost:5173"}/tenant

— Leakly Property Management`,
    };
  },

  tenantAppointmentConfirmation(params: {
    tenantName: string;
    vendorName: string;
    category: string;
    address: string;
    scheduledDate: string;
    scheduledTime: string;
    ticketId?: string;
  }): { subject: string; body: string } {
    return {
      subject: `Appointment confirmed — ${params.category} repair on ${params.scheduledDate}`,
      body: `Hi ${params.tenantName || "there"},

Your appointment has been confirmed! Here are the details:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  APPOINTMENT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Service:    ${params.category} repair
  Technician: ${params.vendorName}
  Date:       ${params.scheduledDate}
  Time:       ${params.scheduledTime}
  Location:   ${params.address}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please make sure someone is available at the unit during the scheduled time. If you need to reschedule, reply to this email.

Track your request: ${process.env.BASE_URL || "http://localhost:5173"}/tenant

— Leakly Property Management`,
    };
  },

  tenantPaymentConfirmation(params: {
    tenantName: string;
    vendorName: string;
    category: string;
    amount: string;
    scheduledDate?: string;
    scheduledTime?: string;
    txHash?: string;
    chain?: string;
  }): { subject: string; body: string } {
    const explorerUrl = params.txHash
      ? params.chain === "solana"
        ? `https://solscan.io/tx/${params.txHash}`
        : `https://basescan.org/tx/${params.txHash}`
      : null;

    const txLine = explorerUrl
      ? `\nTransaction receipt: ${explorerUrl}`
      : "";

    const scheduleLine = params.scheduledDate
      ? `\nYour appointment with ${params.vendorName} is confirmed for ${params.scheduledDate}${params.scheduledTime ? ` at ${params.scheduledTime}` : ""}.`
      : "";

    return {
      subject: `Payment processed — your ${params.category} repair is all set`,
      body: `Hi ${params.tenantName || "there"},

The payment for your ${params.category} repair has been processed successfully.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PAYMENT RECEIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Vendor:  ${params.vendorName}
  Amount:  $${params.amount} USDC
  Status:  Paid
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${txLine}${scheduleLine}

No action needed on your end — everything is taken care of!

— Leakly Property Management`,
    };
  },

  tenantUpdate(params: {
    tenantName: string;
    statusMessage: string;
  }): { subject: string; body: string } {
    return {
      subject: `Update on your maintenance request`,
      body: `Hi ${params.tenantName || "there"},

${params.statusMessage}

— Leakly Property Management`,
    };
  },
};

export const communicationService = {
  templates,

  async createInbox(name: string): Promise<InboxInfo> {
    const inbox = await client.inboxes.create({ displayName: name });
    return {
      id: (inbox as any).inbox_id || (inbox as any).id || (inbox as any).email,
      email: (inbox as any).email || (inbox as any).inbox_id,
      name,
    };
  },

  async listInboxes(): Promise<InboxInfo[]> {
    const result = await client.inboxes.list();
    const inboxes = (result as any).inboxes || result || [];
    return inboxes.map((i: any) => ({
      id: i.inbox_id || i.id || i.email,
      email: i.email || i.inbox_id,
      name: i.display_name || i.name,
    }));
  },

  async sendEmail(params: SendEmailParams): Promise<SendResult> {
    // The inboxId for the SDK is the inbox email address
    const inboxId = params.from;

    const request: any = {
      to: [params.to],
      subject: params.subject,
      text: params.body,
    };

    if (params.threadId) {
      request.thread_id = params.threadId;
    }

    const result = await client.inboxes.messages.send(inboxId, request);
    const data = result as any;

    return {
      messageId: data.message_id || data.messageId || data.id || "",
      threadId: data.thread_id || data.threadId || "",
    };
  },

  async getThread(inboxId: string, threadId: string) {
    const result = await client.inboxes.threads.get(inboxId, threadId);
    return result;
  },

  async listThreads(inboxId: string, limit = 20): Promise<Array<{ id: string }>> {
    const result = await client.inboxes.threads.list(inboxId, { limit });
    const threads = (result as any).threads || result || [];
    return threads.map((t: any) => ({
      id: t.threadId || t.thread_id || t.id,
    }));
  },
};
