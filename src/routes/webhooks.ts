import { Router } from "express";
import { supabase } from "../db/index.js";
import { ticketService } from "../services/ticket.service.js";
import { orchestratorService } from "../services/orchestrator.service.js";
import { eventService } from "../services/event.service.js";
import { communicationService } from "../services/communication.service.js";

export const webhookRouter = Router();

// Track which messages we've already processed
const processedMessageIds = new Set<string>();

/**
 * POST /api/webhooks/poll-inbox
 * Polls the system AgentMail inbox for new messages and processes them.
 * This lets you send real emails (e.g. from Gmail) without needing a public webhook URL.
 */
webhookRouter.post("/poll-inbox", async (_req, res) => {
  try {
    const inboxId = process.env.AGENTMAIL_INBOX || "frightenedcareer628@agentmail.to";
    const threads = await communicationService.listThreads(inboxId);
    let processed = 0;
    const results: Array<{ threadId: string; type: string; ticketId?: string }> = [];

    for (const thread of threads) {
      // Get full thread to find messages
      const fullThread = await communicationService.getThread(inboxId, thread.id);
      const messages = (fullThread as any).messages || [];

      for (const msg of messages) {
        const msgId = msg.messageId || msg.message_id || msg.id;
        if (!msgId || processedMessageIds.has(msgId)) continue;

        // Skip messages sent FROM our own inbox
        const rawFrom = msg.from || msg.sender || "";
        if (rawFrom === inboxId || rawFrom.includes(inboxId)) continue;

        // Skip messages we've already seen (check DB for existing ticket with this email ID)
        processedMessageIds.add(msgId);
        const { data: existingTicket } = await supabase
          .from("tickets")
          .select("id")
          .eq("external_email_id", msgId)
          .maybeSingle();
        if (existingTicket) continue;

        // Extract bare email from "Display Name <email>" format
        const emailMatch = rawFrom.match(/<([^>]+)>/);
        const senderEmail = emailMatch ? emailMatch[1] : rawFrom;
        const emailSubject = msg.subject || "(no subject)";
        const emailBody = msg.text || msg.extractedText || msg.body || msg.html || "";
        const threadId = thread.id;

        console.log(`[Poll] Found email from ${senderEmail}: "${emailSubject}"`);

        // Check if this is a vendor reply or tenant availability reply
        const events = await eventService.list(200);
        const vendorEvent = events.find(
          (e) =>
            e.eventType === "vendor_contacted" &&
            (e.data as Record<string, unknown>)?.threadId === threadId
        );
        const tenantAvailEvent = events.find(
          (e) =>
            e.eventType === "tenant_availability_requested" &&
            (e.data as Record<string, unknown>)?.threadId === threadId
        );

        if (vendorEvent) {
          const ticketId = vendorEvent.ticketId;
          console.log(`[Poll] Vendor reply matched to ticket ${ticketId}`);
          orchestratorService.handleVendorResponse(ticketId, emailBody, senderEmail).catch(console.error);
          results.push({ threadId, type: "vendor_reply", ticketId });
        } else if (tenantAvailEvent) {
          const ticketId = tenantAvailEvent.ticketId;
          console.log(`[Poll] Tenant availability reply matched to ticket ${ticketId}`);
          orchestratorService.handleTenantAvailability(ticketId, emailBody, senderEmail, emailSubject).catch(console.error);
          results.push({ threadId, type: "tenant_availability", ticketId });
        } else {
          // New tenant request — reuse existing handler logic
          const { data: units } = await supabase
            .from("property_units")
            .select("*")
            .eq("tenant_email", senderEmail)
            .limit(1);

          const unit = units?.[0];
          const ticket = await ticketService.create({
            tenantEmail: senderEmail,
            tenantName: unit?.tenant_name ?? undefined,
            propertyUnitId: unit?.id || "UNKNOWN",
            rawSubject: emailSubject,
            rawBody: emailBody,
            externalEmailId: msgId,
          });

          await eventService.log({
            ticketId: ticket.id,
            eventType: "ticket_created",
            actor: "tenant",
            actorId: senderEmail,
            newState: "NEW",
            data: { senderEmail, unitId: unit?.id, subject: emailSubject },
            description: `New maintenance request from ${unit?.tenant_name || senderEmail}: "${emailSubject}"`,
          });

          if (!unit) {
            await ticketService.updateStatus(ticket.id, "REQUIRES_HUMAN_INTERVENTION", {
              failureReason: "Unknown tenant email — cannot map to property unit",
            });
          } else {
            orchestratorService.processNewTicket(ticket.id).catch(console.error);
          }

          results.push({ threadId, type: "new_ticket", ticketId: ticket.id });
        }

        processed++;
      }
    }

    res.json({ processed, results });
  } catch (err) {
    console.error("[Poll] Error polling inbox:", err);
    res.status(500).json({ error: `Poll failed: ${(err as Error).message}` });
  }
});

/**
 * POST /api/webhooks/vendor-reply
 * Simulate a vendor reply from the dashboard (so you don't need curl).
 * Accepts { ticketId, message } and feeds it through the response parser.
 */
webhookRouter.post("/vendor-reply", async (req, res) => {
  try {
    const { ticketId, message } = req.body;
    if (!ticketId || !message) {
      res.status(400).json({ error: "ticketId and message are required" });
      return;
    }

    const ticket = await ticketService.getById(ticketId);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    console.log(`[Webhook] Dashboard vendor reply for ticket ${ticketId}`);
    orchestratorService
      .handleVendorResponse(ticketId, message, ticket.assignedVendorId || "vendor")
      .catch(console.error);

    res.json({ status: "ok", type: "vendor_reply", ticketId });
  } catch (err) {
    res.status(500).json({ error: "Failed to process vendor reply" });
  }
});

/**
 * POST /api/webhooks/agentmail/inbound
 * Receives inbound emails from AgentMail.
 * Determines if it's a new tenant request or a vendor reply.
 */
webhookRouter.post("/agentmail/inbound", async (req, res) => {
  try {
    const payload = req.body;

    const {
      from,
      to,
      subject,
      text,
      body,
      thread_id,
      message_id,
      messageId,
    } = payload;

    const senderEmail = from || "";
    const emailSubject = subject || "(no subject)";
    const emailBody = text || body || "";
    const threadId = thread_id || null;
    const msgId = message_id || messageId || null;

    console.log(`[Webhook] Inbound email from ${senderEmail}: "${emailSubject}"`);

    // Determine if this is a vendor reply (has thread_id matching an existing ticket)
    if (threadId) {
      const isVendorReply = await handleVendorReply(threadId, senderEmail, emailBody, res);
      if (isVendorReply) return;
    }

    // Otherwise, treat as a new tenant maintenance request
    await handleNewTenantRequest(senderEmail, emailSubject, emailBody, msgId, res);
  } catch (err) {
    console.error("[Webhook] Error processing inbound email:", err);
    res.status(500).json({ error: "Internal error processing email" });
  }
});

/**
 * Try to match a vendor reply or tenant availability reply by thread ID
 */
async function handleVendorReply(
  threadId: string,
  senderEmail: string,
  body: string,
  res: any
): Promise<boolean> {
  const events = await eventService.list(200);

  // Check for tenant availability reply first
  const tenantAvailEvent = events.find(
    (e) =>
      e.eventType === "tenant_availability_requested" &&
      (e.data as Record<string, unknown>)?.threadId === threadId
  );

  if (tenantAvailEvent) {
    const ticketId = tenantAvailEvent.ticketId;
    console.log(`[Webhook] Tenant availability reply matched to ticket ${ticketId}`);
    orchestratorService.handleTenantAvailability(ticketId, body, senderEmail).catch((err) => {
      console.error(`[Webhook] Error handling tenant availability for ${ticketId}:`, err);
    });
    res.json({ status: "ok", type: "tenant_availability", ticketId });
    return true;
  }

  // Check for vendor reply
  const matchingEvent = events.find(
    (e) =>
      e.eventType === "vendor_contacted" &&
      (e.data as Record<string, unknown>)?.threadId === threadId
  );

  if (!matchingEvent) return false;

  const ticketId = matchingEvent.ticketId;
  console.log(`[Webhook] Vendor reply matched to ticket ${ticketId}`);

  // Process async so webhook responds quickly
  orchestratorService.handleVendorResponse(ticketId, body, senderEmail).catch((err) => {
    console.error(`[Webhook] Error handling vendor response for ${ticketId}:`, err);
  });

  res.json({ status: "ok", type: "vendor_reply", ticketId });
  return true;
}

/**
 * Handle a new tenant maintenance request email
 */
async function handleNewTenantRequest(
  senderEmail: string,
  subject: string,
  body: string,
  externalEmailId: string | null,
  res: any
) {
  // Look up property unit by tenant email
  const { data: units } = await supabase
    .from("property_units")
    .select("*")
    .eq("tenant_email", senderEmail)
    .limit(1);

  const unit = units?.[0];

  if (!unit) {
    console.warn(`[Webhook] Unknown tenant email: ${senderEmail}`);
    // Still create ticket but mark for review
    const ticket = await ticketService.create({
      tenantEmail: senderEmail,
      propertyUnitId: "UNKNOWN",
      rawSubject: subject,
      rawBody: body,
      externalEmailId: externalEmailId ?? undefined,
    });

    await eventService.log({
      ticketId: ticket.id,
      eventType: "ticket_created",
      actor: "system",
      newState: "NEW",
      data: { senderEmail, note: "Unknown tenant — requires manual unit assignment" },
      description: `Ticket created from unknown tenant ${senderEmail}`,
    });

    await ticketService.updateStatus(ticket.id, "REQUIRES_HUMAN_INTERVENTION", {
      failureReason: "Unknown tenant email — cannot map to property unit",
    });

    res.json({ status: "ok", type: "new_ticket", ticketId: ticket.id, note: "unknown_tenant" });
    return;
  }

  // Create ticket
  const ticket = await ticketService.create({
    tenantEmail: senderEmail,
    tenantName: unit.tenant_name ?? undefined,
    propertyUnitId: unit.id,
    rawSubject: subject,
    rawBody: body,
    externalEmailId: externalEmailId ?? undefined,
  });

  await eventService.log({
    ticketId: ticket.id,
    eventType: "ticket_created",
    actor: "tenant",
    actorId: senderEmail,
    newState: "NEW",
    data: { senderEmail, unitId: unit.id, subject },
    description: `New maintenance request from ${unit.tenant_name || senderEmail}: "${subject}"`,
  });

  console.log(`[Webhook] Created ticket ${ticket.id} for ${senderEmail} at unit ${unit.id}`);

  // Kick off orchestrator (async — don't block webhook response)
  orchestratorService.processNewTicket(ticket.id).catch((err) => {
    console.error(`[Orchestrator] Failed to process ticket ${ticket.id}:`, err);
  });

  res.json({ status: "ok", type: "new_ticket", ticketId: ticket.id });
}
