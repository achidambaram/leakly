/**
 * Orchestrator Service — Central brain that drives tickets through the state machine.
 * Coordinates: Classification → Policy → Vendor Selection → Vendor Contact
 */

import { ticketService } from "./ticket.service.js";
import { classificationService } from "./classification.service.js";
import { vendorService } from "./vendor.service.js";
import { communicationService } from "./communication.service.js";
import { memoryService } from "./memory.service.js";
import { responseParserService, type ParsedVendorResponse } from "./response-parser.service.js";
import { paymentService } from "./payment.service.js";
import { spongeService } from "./sponge.service.js";
import { eventService } from "./event.service.js";
import { supabase } from "../db/index.js";

// Policy configuration
const POLICY = {
  autoApproveLimit: 200,
  emergencyKeywords: ["gas leak", "no heat", "flood", "fire", "electrical fire", "sewage", "carbon monoxide"],
  maxVendorRetries: 2,
};

// Demo mode: override all payment amounts to a tiny value
const DEMO_PAYMENT_AMOUNT = process.env.DEMO_PAYMENT_AMOUNT
  ? parseFloat(process.env.DEMO_PAYMENT_AMOUNT)
  : null;

// The system's AgentMail inbox — use the pre-provisioned inbox
const LEAKLY_INBOX = process.env.AGENTMAIL_INBOX || "frightenedcareer628@agentmail.to";
let SYSTEM_INBOX_EMAIL: string | null = null;
let SYSTEM_INBOX_ID: string | null = null;

export const orchestratorService = {
  /**
   * Ensure we have a system inbox for sending emails
   */
  async ensureInbox(): Promise<{ id: string; email: string }> {
    if (SYSTEM_INBOX_ID && SYSTEM_INBOX_EMAIL) {
      return { id: SYSTEM_INBOX_ID, email: SYSTEM_INBOX_EMAIL };
    }

    // Use the pre-provisioned inbox
    SYSTEM_INBOX_ID = LEAKLY_INBOX;
    SYSTEM_INBOX_EMAIL = LEAKLY_INBOX;
    return { id: LEAKLY_INBOX, email: LEAKLY_INBOX };
  },

  /**
   * Main entry point: process a new ticket through the full workflow
   */
  async processNewTicket(ticketId: string): Promise<void> {
    const ticket = await ticketService.getById(ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`);

    console.log(`[Orchestrator] Processing ticket ${ticketId}: "${ticket.rawSubject}"`);

    // Step 1: Classify
    const classification = await this.classifyTicket(ticketId, ticket.rawSubject, ticket.rawBody);
    if (!classification) return; // sent to human intervention

    // Step 2: Evaluate policy
    const policyDecision = this.evaluatePolicy(classification);
    await ticketService.update(ticketId, {
      status: "PRIORITIZED",
      policyDecision,
    });
    await eventService.log({
      ticketId,
      eventType: "status_changed",
      actor: "system",
      previousState: "CLASSIFIED",
      newState: "PRIORITIZED",
      data: { policyDecision },
      description: `Policy evaluated: ${policyDecision}`,
    });

    // Step 3: Enrich context from Supermemory
    const memoryContext = await this.enrichContext(ticketId, ticket, classification.category);

    // Step 4: Select vendor
    const vendorResult = await this.selectAndAssignVendor(ticketId, classification.category);
    if (!vendorResult) return; // no vendor available → human intervention

    // Step 5: Contact vendor (with past context from Supermemory)
    await this.contactVendor(ticketId, vendorResult.vendor, classification, ticket, memoryContext);
  },

  /**
   * Step 1: AI Classification
   */
  async classifyTicket(ticketId: string, subject: string, body: string) {
    try {
      const classification = await classificationService.classify(subject, body);

      if (classification.confidence < 0.5) {
        await ticketService.updateStatus(ticketId, "REQUIRES_HUMAN_INTERVENTION", {
          classification,
          failureReason: `Low AI confidence: ${classification.confidence}`,
        });
        await eventService.log({
          ticketId,
          eventType: "ai_classification",
          actor: "ai",
          previousState: "NEW",
          newState: "REQUIRES_HUMAN_INTERVENTION",
          data: { classification },
          description: `Classification confidence too low (${classification.confidence.toFixed(2)}) — requires human review`,
        });
        return null;
      }

      await ticketService.update(ticketId, {
        status: "CLASSIFIED",
        classification,
      });
      await eventService.log({
        ticketId,
        eventType: "ai_classification",
        actor: "ai",
        previousState: "NEW",
        newState: "CLASSIFIED",
        data: { classification },
        description: `Classified as ${classification.category} (${classification.urgency}, confidence: ${classification.confidence.toFixed(2)})`,
      });

      return classification;
    } catch (err) {
      await ticketService.updateStatus(ticketId, "REQUIRES_HUMAN_INTERVENTION", {
        failureReason: `Classification error: ${(err as Error).message}`,
      });
      await eventService.log({
        ticketId,
        eventType: "error",
        actor: "system",
        data: { error: (err as Error).message },
        description: `Classification failed: ${(err as Error).message}`,
      });
      return null;
    }
  },

  /**
   * Step 2: Policy evaluation
   */
  evaluatePolicy(classification: { urgency: string; estimatedCostMax: number }): "auto_approved" | "pending_approval" {
    if (classification.urgency === "emergency") return "auto_approved";
    if (classification.estimatedCostMax <= POLICY.autoApproveLimit) return "auto_approved";
    return "pending_approval";
  },

  /**
   * Step 3: Context enrichment from Supermemory
   */
  async enrichContext(ticketId: string, ticket: { tenantEmail: string; propertyUnitId: string }, category: string) {
    try {
      const context = await memoryService.getTicketContext({
        tenantEmail: ticket.tenantEmail,
        propertyUnitId: ticket.propertyUnitId,
        category,
      });

      // Build summary of what Supermemory found
      const findings: string[] = [];
      if (context.unitHistory.length > 0) {
        findings.push(`Unit has ${context.unitHistory.length} past issue(s): ${context.unitHistory[0].content.slice(0, 100)}`);
      }
      if (context.tenantHistory.length > 0) {
        findings.push(`Tenant has ${context.tenantHistory.length} prior request(s)`);
      }
      if (context.vendorPerformance.length > 0) {
        findings.push(`${context.vendorPerformance.length} vendor performance record(s) found`);
      }

      const description = findings.length > 0
        ? `Supermemory context: ${findings.join(". ")}`
        : `Supermemory: no prior history found for this unit/tenant (first-time request)`;

      await eventService.log({
        ticketId,
        eventType: "memory_lookup",
        actor: "ai",
        data: {
          tenantHistoryCount: context.tenantHistory.length,
          unitHistoryCount: context.unitHistory.length,
          vendorPerfCount: context.vendorPerformance.length,
          unitHistory: context.unitHistory.slice(0, 3).map((m) => m.content),
          tenantHistory: context.tenantHistory.slice(0, 2).map((m) => m.content),
        },
        description,
      });

      return context;
    } catch (err) {
      // Non-fatal — continue without context
      console.warn(`[Orchestrator] Memory lookup failed (non-fatal): ${(err as Error).message}`);
      return null;
    }
  },

  /**
   * Step 4: Vendor selection
   */
  async selectAndAssignVendor(ticketId: string, category: string, excludeIds: string[] = []) {
    const result = await vendorService.selectVendor(category, excludeIds);

    if (!result) {
      await ticketService.updateStatus(ticketId, "REQUIRES_HUMAN_INTERVENTION", {
        failureReason: `No available vendor for category: ${category}`,
      });
      await eventService.log({
        ticketId,
        eventType: "escalation",
        actor: "system",
        previousState: "PRIORITIZED",
        newState: "REQUIRES_HUMAN_INTERVENTION",
        data: { category, excludeIds },
        description: `No vendor available for ${category} — escalated to human`,
      });
      return null;
    }

    await ticketService.update(ticketId, {
      status: "VENDOR_SELECTED",
      assignedVendorId: result.vendor.id,
    });
    await eventService.log({
      ticketId,
      eventType: "vendor_selected",
      actor: "system",
      previousState: "PRIORITIZED",
      newState: "VENDOR_SELECTED",
      data: { vendorId: result.vendor.id, vendorName: result.vendor.name, score: result.score, reason: result.reason },
      description: `Selected vendor: ${result.vendor.name} (${result.reason})`,
    });

    return result;
  },

  /**
   * Step 5: Contact vendor via email
   */
  async contactVendor(
    ticketId: string,
    vendor: { id: string; name: string; email: string },
    classification: { category: string; description: string; urgency: string },
    ticket: { propertyUnitId: string; tenantEmail: string; tenantName: string | null },
    memoryContext?: { tenantHistory: any[]; unitHistory: any[]; vendorPerformance: any[] } | null
  ) {
    const inbox = await this.ensureInbox();

    // Get property address
    const { data: unit } = await supabase
      .from("property_units")
      .select("*")
      .eq("id", ticket.propertyUnitId)
      .single();

    const address = unit
      ? `${unit.address}, Unit ${unit.unit_number}`
      : ticket.propertyUnitId;

    // Build past context summary from Supermemory results
    let pastContext: string | undefined;
    if (memoryContext) {
      const lines: string[] = [];
      if (memoryContext.unitHistory.length > 0) {
        lines.push("Past issues at this unit:");
        memoryContext.unitHistory.slice(0, 3).forEach((m) => lines.push(`  - ${m.content}`));
      }
      if (memoryContext.tenantHistory.length > 0) {
        lines.push("Tenant history:");
        memoryContext.tenantHistory.slice(0, 2).forEach((m) => lines.push(`  - ${m.content}`));
      }
      if (lines.length > 0) pastContext = lines.join("\n");
    }

    // Generate email from template
    const { subject, body } = communicationService.templates.vendorRequest({
      vendorName: vendor.name,
      category: classification.category,
      description: classification.description,
      address,
      urgency: classification.urgency,
      pastContext,
    });

    try {
      const result = await communicationService.sendEmail({
        to: vendor.email,
        from: inbox.email,
        subject,
        body,
      });

      await ticketService.update(ticketId, {
        status: "VENDOR_CONTACTED",
        vendorContactedAt: new Date().toISOString(),
      });
      await eventService.log({
        ticketId,
        eventType: "vendor_contacted",
        actor: "system",
        previousState: "VENDOR_SELECTED",
        newState: "VENDOR_CONTACTED",
        data: { vendorId: vendor.id, vendorEmail: vendor.email, messageId: result.messageId, threadId: result.threadId },
        description: `Contacted vendor ${vendor.name} at ${vendor.email}`,
      });

      // Also notify tenant
      await this.notifyTenant(ticketId, ticket, vendor.name, classification.category);

      console.log(`[Orchestrator] Ticket ${ticketId}: vendor ${vendor.name} contacted`);
    } catch (err) {
      await ticketService.updateStatus(ticketId, "FAILED", {
        failureReason: `Failed to send vendor email: ${(err as Error).message}`,
      });
      await eventService.log({
        ticketId,
        eventType: "error",
        actor: "system",
        previousState: "VENDOR_SELECTED",
        newState: "FAILED",
        data: { error: (err as Error).message },
        description: `Failed to contact vendor: ${(err as Error).message}`,
      });
    }
  },

  /**
   * Send tenant a notification that a vendor has been assigned
   */
  async notifyTenant(
    ticketId: string,
    ticket: { tenantEmail: string; tenantName: string | null },
    vendorName: string,
    category: string
  ) {
    try {
      const inbox = await this.ensureInbox();
      const { subject, body } = communicationService.templates.tenantConfirmation({
        tenantName: ticket.tenantName || "there",
        vendorName,
        category,
        ticketId,
      });

      await communicationService.sendEmail({
        to: ticket.tenantEmail,
        from: inbox.email,
        subject,
        body,
      });

      await eventService.log({
        ticketId,
        eventType: "email_sent",
        actor: "system",
        data: { to: ticket.tenantEmail, type: "tenant_notification" },
        description: `Tenant notified: vendor ${vendorName} assigned`,
      });
    } catch (err) {
      // Non-fatal — vendor contact is what matters
      console.warn(`[Orchestrator] Failed to notify tenant (non-fatal): ${(err as Error).message}`);
    }
  },

  /**
   * Handle a vendor reply (called from webhook)
   */
  async handleVendorResponse(ticketId: string, responseText: string, vendorEmail: string, subject?: string) {
    const ticket = await ticketService.getById(ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`);

    await ticketService.update(ticketId, {
      vendorRespondedAt: new Date().toISOString(),
    });

    // Parse the vendor's response with AI
    console.log(`[Orchestrator] Parsing vendor response for ticket ${ticketId}`);
    const parsed = await responseParserService.parseVendorResponse(responseText, subject);

    await eventService.log({
      ticketId,
      eventType: "vendor_responded",
      actor: "vendor",
      data: { vendorEmail, parsed, responsePreview: responseText.slice(0, 200) },
      description: `Vendor responded (${parsed.intent}): ${parsed.summary}`,
    });

    // Route based on intent
    switch (parsed.intent) {
      case "confirmed":
        await this.handleVendorConfirmed(ticketId, ticket, parsed);
        break;
      case "declined":
        await this.handleVendorDeclined(ticketId, ticket, parsed);
        break;
      case "counter_offer":
        await this.handleVendorCounterOffer(ticketId, ticket, parsed);
        break;
      case "unclear":
        await this.handleVendorUnclear(ticketId, ticket, parsed);
        break;
    }
  },

  /**
   * Vendor confirmed — move to SCHEDULED, notify tenant
   */
  async handleVendorConfirmed(ticketId: string, ticket: any, parsed: ParsedVendorResponse) {
    await ticketService.update(ticketId, {
      status: "SCHEDULED",
      scheduledDate: parsed.scheduledDate ?? undefined,
      scheduledTimeSlot: parsed.scheduledTime ?? undefined,
    });

    await eventService.log({
      ticketId,
      eventType: "schedule_confirmed",
      actor: "system",
      previousState: "VENDOR_CONTACTED",
      newState: "SCHEDULED",
      data: { date: parsed.scheduledDate, time: parsed.scheduledTime },
      description: `Scheduled: ${parsed.scheduledDate || "TBD"} at ${parsed.scheduledTime || "TBD"}`,
    });

    // Notify tenant
    const vendor = ticket.assignedVendorId
      ? await vendorService.getById(ticket.assignedVendorId)
      : null;

    const inbox = await this.ensureInbox();
    const { subject, body } = communicationService.templates.tenantConfirmation({
      tenantName: ticket.tenantName || "there",
      vendorName: vendor?.name || "your assigned technician",
      category: ticket.classification?.category || "maintenance",
      scheduledDate: parsed.scheduledDate ?? undefined,
      scheduledTime: parsed.scheduledTime ?? undefined,
    });

    try {
      await communicationService.sendEmail({
        to: ticket.tenantEmail,
        from: inbox.email,
        subject,
        body,
      });
      await eventService.log({
        ticketId,
        eventType: "email_sent",
        actor: "system",
        data: { to: ticket.tenantEmail, type: "scheduling_confirmation" },
        description: `Tenant notified of confirmed schedule`,
      });
    } catch (err) {
      console.warn(`[Orchestrator] Failed to notify tenant of schedule: ${(err as Error).message}`);
    }

    console.log(`[Orchestrator] Ticket ${ticketId}: SCHEDULED (${parsed.scheduledDate} ${parsed.scheduledTime})`);

    // Trigger payment flow
    await this.triggerPayment(ticketId, ticket);
  },

  /**
   * Payment flow: evaluate if payment is needed, create link or auto-complete
   */
  async triggerPayment(ticketId: string, ticket: any) {
    const classification = ticket.classification;
    const costEstimate = classification?.estimatedCostMax || 0;
    const policyDecision = ticket.policyDecision;

    // No cost → complete immediately
    if (costEstimate === 0) {
      await ticketService.updateStatus(ticketId, "COMPLETED");
      await eventService.log({
        ticketId,
        eventType: "status_changed",
        actor: "system",
        previousState: "SCHEDULED",
        newState: "COMPLETED",
        description: "No payment needed (zero cost) — ticket completed",
      });
      return;
    }

    // Auto-approved and under limit → create payment link directly
    if (policyDecision === "auto_approved" && costEstimate <= POLICY.autoApproveLimit) {
      await this.createAndSendPaymentLink(ticketId, ticket, costEstimate);
      return;
    }

    // Emergency auto-approved (bypass approval under $500)
    if (policyDecision === "auto_approved" && classification?.urgency === "emergency" && costEstimate <= 500) {
      await this.createAndSendPaymentLink(ticketId, ticket, costEstimate);
      return;
    }

    // Requires approval — notify property manager, wait
    if (policyDecision === "pending_approval" || costEstimate > POLICY.autoApproveLimit) {
      await ticketService.update(ticketId, {
        policyDecision: "pending_approval",
      });
      await this.sendApprovalRequest(ticketId, ticket, costEstimate);
      return;
    }

    // Default: auto-approve (shouldn't reach here normally)
    await this.createAndSendPaymentLink(ticketId, ticket, costEstimate);
  },

  /**
   * Create payment and move ticket to PAYMENT_PENDING.
   * Prefers Sponge (USDC) for auto-approved payments when vendor has a wallet.
   */
  async createAndSendPaymentLink(ticketId: string, ticket: any, costEstimate: number) {
    const actualCost = DEMO_PAYMENT_AMOUNT ?? costEstimate;
    const amountCents = Math.round(actualCost * 100);
    const vendorId = ticket.assignedVendorId || "unknown";
    const description = `Maintenance: ${ticket.classification?.category} — ${ticket.classification?.description || ticket.rawSubject}`;

    const method = await paymentService.getPreferredMethod(vendorId);

    if (method === "sponge") {
      const vendorWallet = (await spongeService.getVendorWallet(vendorId))!;
      const payment = await paymentService.createSpongePayment({
        ticketId,
        vendorId,
        vendorWallet,
        amount: amountCents,
        description,
      });

      if (payment.transferStatus === "transferred") {
        // Transfer succeeded on-chain
        await ticketService.update(ticketId, {
          status: "COMPLETED",
          paymentStatus: "paid",
          paymentIntentId: payment.paymentIntentId ?? undefined,
          paymentAmount: actualCost,
          paymentMethod: "sponge",
        });

        await eventService.log({
          ticketId,
          eventType: "payment_completed",
          actor: "system",
          previousState: "SCHEDULED",
          newState: "COMPLETED",
          data: {
            paymentId: payment.id,
            amount: amountCents,
            method: "sponge",
            chain: spongeService.defaultChain,
            vendorWallet,
            txHash: payment.txHash,
          },
          description: `Sponge USDC payment completed: $${actualCost.toFixed(4)} → ${vendorWallet} (${spongeService.defaultChain}) tx: ${payment.txHash}`,
        });

        console.log(`[Orchestrator] Ticket ${ticketId}: Sponge payment completed ($${actualCost} → ${vendorWallet}, tx: ${payment.txHash})`);
      } else {
        // Transfer failed or still pending
        await ticketService.update(ticketId, {
          status: "PAYMENT_PENDING",
          paymentStatus: payment.transferStatus === "failed" ? "failed" : "sponge_pending",
          paymentIntentId: payment.paymentIntentId ?? undefined,
          paymentAmount: actualCost,
          paymentMethod: "sponge",
        });

        await eventService.log({
          ticketId,
          eventType: "payment_created",
          actor: "system",
          previousState: "SCHEDULED",
          newState: "PAYMENT_PENDING",
          data: {
            paymentId: payment.id,
            amount: amountCents,
            method: "sponge",
            chain: spongeService.defaultChain,
            vendorWallet,
            transferStatus: payment.transferStatus,
          },
          description: `Sponge USDC payment ${payment.transferStatus}: $${actualCost.toFixed(4)} → ${vendorWallet} (${spongeService.defaultChain})`,
        });

        console.log(`[Orchestrator] Ticket ${ticketId}: Sponge payment ${payment.transferStatus} ($${actualCost} → ${vendorWallet})`);
      }
      return;
    }

    // Stripe / mock fallback
    const payment = await paymentService.createPaymentLink({
      ticketId,
      vendorId,
      amount: amountCents,
      description,
    });

    await ticketService.update(ticketId, {
      status: "PAYMENT_PENDING",
      paymentStatus: "link_sent",
      paymentIntentId: payment.paymentIntentId ?? undefined,
      paymentAmount: actualCost,
      paymentMethod: method,
    });

    await eventService.log({
      ticketId,
      eventType: "payment_created",
      actor: "system",
      previousState: "SCHEDULED",
      newState: "PAYMENT_PENDING",
      data: { paymentId: payment.id, amount: amountCents, url: payment.paymentLinkUrl, mock: paymentService.isMock, method },
      description: `Payment link created: $${actualCost.toFixed(4)} → ${payment.paymentLinkUrl}`,
    });

    console.log(`[Orchestrator] Ticket ${ticketId}: payment link created ($${costEstimate})`);
  },

  /**
   * Send approval request email to property manager
   */
  async sendApprovalRequest(ticketId: string, ticket: any, costEstimate: number) {
    const inbox = await this.ensureInbox();
    const managerEmail = "manager@leakly.example.com"; // MVP hardcoded

    const subject = `Approval needed: ${ticket.classification?.category} repair — $${costEstimate}`;
    const body = `A maintenance repair requires your approval:

Ticket: ${ticketId}
Category: ${ticket.classification?.category}
Urgency: ${ticket.classification?.urgency}
Description: ${ticket.classification?.description}
Estimated Cost: $${costEstimate}
Tenant: ${ticket.tenantName || ticket.tenantEmail}
Vendor: ${ticket.assignedVendorId}

To approve, POST to: ${process.env.BASE_URL || "http://localhost:3001"}/api/payments/tickets/${ticketId}/approve-payment

— Leakly Automated Dispatch`;

    try {
      await communicationService.sendEmail({
        to: managerEmail,
        from: inbox.email,
        subject,
        body,
      });
      await eventService.log({
        ticketId,
        eventType: "email_sent",
        actor: "system",
        data: { to: managerEmail, type: "approval_request", costEstimate },
        description: `Approval request sent to property manager ($${costEstimate})`,
      });
    } catch (err) {
      console.warn(`[Orchestrator] Failed to send approval email: ${(err as Error).message}`);
    }

    console.log(`[Orchestrator] Ticket ${ticketId}: awaiting manager approval ($${costEstimate})`);
  },

  /**
   * Vendor declined — try next vendor or escalate
   */
  async handleVendorDeclined(ticketId: string, ticket: any, parsed: ParsedVendorResponse) {
    const currentRetry = ticket.retryCount || 0;

    await eventService.log({
      ticketId,
      eventType: "status_changed",
      actor: "system",
      data: { reason: parsed.reason, retryCount: currentRetry },
      description: `Vendor declined: ${parsed.reason || "no reason given"}. Retry ${currentRetry}/${POLICY.maxVendorRetries}`,
    });

    if (currentRetry >= POLICY.maxVendorRetries) {
      // Exhausted retries — escalate
      await ticketService.updateStatus(ticketId, "REQUIRES_HUMAN_INTERVENTION", {
        retryCount: currentRetry,
        failureReason: `All vendors declined or exhausted retries (${currentRetry}). Last decline: ${parsed.reason}`,
      });
      await eventService.log({
        ticketId,
        eventType: "escalation",
        actor: "system",
        previousState: "VENDOR_CONTACTED",
        newState: "REQUIRES_HUMAN_INTERVENTION",
        description: `Escalated: ${currentRetry} vendors declined, max retries reached`,
      });
      return;
    }

    // Try next vendor (exclude current)
    const excludeIds = [ticket.assignedVendorId].filter(Boolean);
    const category = ticket.classification?.category || "general";
    const nextVendor = await vendorService.selectVendor(category, excludeIds);

    if (!nextVendor) {
      await ticketService.updateStatus(ticketId, "REQUIRES_HUMAN_INTERVENTION", {
        retryCount: currentRetry + 1,
        failureReason: `No alternative vendor available for ${category}`,
      });
      await eventService.log({
        ticketId,
        eventType: "escalation",
        actor: "system",
        newState: "REQUIRES_HUMAN_INTERVENTION",
        description: `No alternative vendor for ${category} — escalated`,
      });
      return;
    }

    // Assign new vendor and contact them
    await ticketService.update(ticketId, {
      status: "VENDOR_SELECTED",
      assignedVendorId: nextVendor.vendor.id,
      retryCount: currentRetry + 1,
      vendorContactedAt: undefined,
      vendorRespondedAt: undefined,
    });

    await eventService.log({
      ticketId,
      eventType: "vendor_selected",
      actor: "system",
      previousState: "VENDOR_CONTACTED",
      newState: "VENDOR_SELECTED",
      data: { vendorId: nextVendor.vendor.id, vendorName: nextVendor.vendor.name, retry: currentRetry + 1 },
      description: `Re-selected vendor: ${nextVendor.vendor.name} (retry ${currentRetry + 1})`,
    });

    // Contact new vendor
    await this.contactVendor(ticketId, nextVendor.vendor, ticket.classification, ticket);
    console.log(`[Orchestrator] Ticket ${ticketId}: vendor declined, trying ${nextVendor.vendor.name}`);
  },

  /**
   * Vendor counter-offer — for MVP, treat as confirmed with their proposed time
   */
  async handleVendorCounterOffer(ticketId: string, ticket: any, parsed: ParsedVendorResponse) {
    // For hackathon MVP, accept counter-offers automatically
    console.log(`[Orchestrator] Ticket ${ticketId}: vendor counter-offer accepted automatically`);
    await this.handleVendorConfirmed(ticketId, ticket, parsed);
  },

  /**
   * Vendor response unclear — flag for human review
   */
  async handleVendorUnclear(ticketId: string, ticket: any, parsed: ParsedVendorResponse) {
    if (parsed.confidence < 0.5) {
      await ticketService.updateStatus(ticketId, "REQUIRES_HUMAN_INTERVENTION", {
        failureReason: `Vendor response unclear (confidence ${parsed.confidence.toFixed(2)}): ${parsed.summary}`,
      });
      await eventService.log({
        ticketId,
        eventType: "escalation",
        actor: "system",
        previousState: "VENDOR_CONTACTED",
        newState: "REQUIRES_HUMAN_INTERVENTION",
        data: { parsed },
        description: `Vendor response unclear — escalated for human review`,
      });
    } else {
      // Moderate confidence — log but keep waiting
      await eventService.log({
        ticketId,
        eventType: "vendor_responded",
        actor: "system",
        data: { parsed, note: "Ambiguous response, keeping ticket in VENDOR_CONTACTED" },
        description: `Vendor response ambiguous, awaiting clearer reply`,
      });
    }
  },

  /**
   * Check for timed-out vendor contacts and retry/escalate
   */
  async checkTimeouts(): Promise<{ processed: number; results: Array<{ ticketId: string; action: string }> }> {
    const allTickets = await ticketService.list({ status: "VENDOR_CONTACTED" });
    const now = Date.now();
    const results: Array<{ ticketId: string; action: string }> = [];

    for (const ticket of allTickets) {
      if (!ticket.vendorContactedAt) continue;

      const contactedAt = new Date(ticket.vendorContactedAt).getTime();
      const hoursSince = (now - contactedAt) / (1000 * 60 * 60);

      // Emergency: 2h timeout, others: 24h
      const isEmergency = ticket.classification?.urgency === "emergency";
      const timeoutHours = isEmergency ? 2 : 24;

      if (hoursSince >= timeoutHours) {
        console.log(`[Orchestrator] Ticket ${ticket.id}: vendor timeout (${hoursSince.toFixed(1)}h)`);

        await eventService.log({
          ticketId: ticket.id,
          eventType: "retry",
          actor: "system",
          data: { hoursSince, timeoutHours, isEmergency },
          description: `Vendor timeout after ${hoursSince.toFixed(1)}h (limit: ${timeoutHours}h)`,
        });

        // Simulate a "declined" to trigger retry logic
        await this.handleVendorDeclined(ticket.id, ticket, {
          intent: "declined",
          confidence: 1,
          scheduledDate: null,
          scheduledTime: null,
          reason: `No response after ${hoursSince.toFixed(1)} hours`,
          summary: `Vendor did not respond within ${timeoutHours}h timeout`,
        });

        results.push({ ticketId: ticket.id, action: "timeout_retry" });
      }
    }

    return { processed: results.length, results };
  },
};
