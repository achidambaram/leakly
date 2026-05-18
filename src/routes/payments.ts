import { Router } from "express";
import { paymentService } from "../services/payment.service.js";
import { spongeService } from "../services/sponge.service.js";
import { ticketService } from "../services/ticket.service.js";
import { eventService } from "../services/event.service.js";
import { memoryService } from "../services/memory.service.js";

export const paymentRouter = Router();

const DEMO_PAYMENT_AMT = process.env.DEMO_PAYMENT_AMOUNT
  ? parseFloat(process.env.DEMO_PAYMENT_AMOUNT)
  : null;

/**
 * POST /api/payments/sponge-pay/:ticketId
 * One-shot Sponge USDC payment: creates record + returns transfer params for MCP execution.
 * The actual transfer is executed via mcp__sponge__transfer by the AI agent.
 */
paymentRouter.post("/sponge-pay/:ticketId", async (req, res) => {
  try {
    const { ticketId } = req.params;
    const ticket = await ticketService.getById(ticketId);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    // Get vendor wallet
    const vendorId = ticket.assignedVendorId || "unknown";
    const vendorWallet = await spongeService.getVendorWallet(vendorId);
    if (!vendorWallet) {
      res.status(400).json({ error: "No vendor wallet configured" });
      return;
    }

    const costEstimate = DEMO_PAYMENT_AMT ?? (ticket.classification?.estimatedCostMax || 0);
    const chain = spongeService.defaultChain;

    // Create payment record
    const payment = await spongeService.createPayment({
      ticketId,
      vendorId,
      vendorWallet,
      amount: costEstimate,
      description: `Maintenance: ${ticket.classification?.category} — ${ticket.classification?.description || ticket.rawSubject}`,
      chain: chain as any,
    });

    await ticketService.update(ticketId, {
      status: "PAYMENT_PENDING",
      paymentStatus: "sponge_pending",
      paymentIntentId: `sponge_${payment.id.slice(0, 8)}`,
      paymentAmount: costEstimate,
      paymentMethod: "sponge",
    });

    await eventService.log({
      ticketId,
      eventType: "payment_created",
      actor: "system",
      previousState: ticket.status,
      newState: "PAYMENT_PENDING",
      data: { paymentId: payment.id, amount: costEstimate, method: "sponge", chain, vendorWallet },
      description: `Sponge USDC payment queued: $${costEstimate} → ${vendorWallet} (${chain})`,
    });

    // Return transfer params so the MCP agent can execute
    res.json({
      status: "queued",
      paymentId: payment.id,
      ticketId,
      transfer: {
        chain,
        to: vendorWallet,
        amount: String(costEstimate),
        token: "USDC",
      },
    });
  } catch (err) {
    res.status(500).json({ error: `Sponge pay failed: ${(err as Error).message}` });
  }
});

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events (checkout.session.completed, payment_intent.payment_failed)
 */
paymentRouter.post("/webhooks/stripe", async (req, res) => {
  try {
    const event = req.body;
    const eventType = event.type || event.eventType;

    console.log(`[Stripe Webhook] Received: ${eventType}`);

    switch (eventType) {
      case "checkout.session.completed": {
        const session = event.data?.object || event;
        const paymentRecordId = session.metadata?.paymentRecordId;
        const ticketId = session.metadata?.ticketId;

        if (paymentRecordId) {
          await paymentService.markPaid(paymentRecordId);
        }

        if (ticketId) {
          await ticketService.updateStatus(ticketId, "PAYMENT_COMPLETED");
          await eventService.log({
            ticketId,
            eventType: "payment_completed",
            actor: "system",
            previousState: "PAYMENT_PENDING",
            newState: "PAYMENT_COMPLETED",
            data: { paymentRecordId, stripeEvent: eventType },
            description: "Payment completed via Stripe",
          });

          // Auto-complete ticket after payment
          await ticketService.updateStatus(ticketId, "COMPLETED");
          await eventService.log({
            ticketId,
            eventType: "status_changed",
            actor: "system",
            previousState: "PAYMENT_COMPLETED",
            newState: "COMPLETED",
            description: "Ticket completed after payment received",
          });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data?.object || event;
        const ticketId = intent.metadata?.ticketId;
        const paymentRecordId = intent.metadata?.paymentRecordId;

        if (paymentRecordId) {
          await paymentService.markFailed(paymentRecordId);
        }

        if (ticketId) {
          await ticketService.update(ticketId, {
            paymentStatus: "failed",
            failureReason: "Payment failed via Stripe",
          });
          await eventService.log({
            ticketId,
            eventType: "payment_failed",
            actor: "system",
            data: { paymentRecordId },
            description: "Payment failed — notifying property manager",
          });
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("[Stripe Webhook] Error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

/**
 * POST /api/payments/:id/simulate-pay
 * Mock endpoint to simulate payment completion (for demo without real Stripe)
 */
paymentRouter.post("/:id/simulate-pay", async (req, res) => {
  try {
    const payment = await paymentService.getById(req.params.id);
    if (!payment) {
      res.status(404).json({ error: "Payment record not found" });
      return;
    }

    // Mark paid
    await paymentService.markPaid(payment.id);

    // Update ticket
    await ticketService.updateStatus(payment.ticketId, "PAYMENT_COMPLETED", {
      paymentStatus: "paid",
    });
    await eventService.log({
      ticketId: payment.ticketId,
      eventType: "payment_completed",
      actor: "system",
      previousState: "PAYMENT_PENDING",
      newState: "PAYMENT_COMPLETED",
      data: { paymentId: payment.id, amount: payment.amount, mock: true },
      description: `Payment of $${(payment.amount / 100).toFixed(2)} completed (simulated)`,
    });

    // Auto-complete
    await ticketService.updateStatus(payment.ticketId, "COMPLETED");
    await eventService.log({
      ticketId: payment.ticketId,
      eventType: "status_changed",
      actor: "system",
      previousState: "PAYMENT_COMPLETED",
      newState: "COMPLETED",
      description: "Ticket completed after payment received",
    });

    res.json({
      status: "paid",
      ticketId: payment.ticketId,
      amount: payment.amount,
      message: "Payment simulated successfully — ticket marked COMPLETED",
    });
  } catch (err) {
    res.status(500).json({ error: `Simulate payment failed: ${(err as Error).message}` });
  }
});

/**
 * GET /api/payments/:ticketId
 * Get payment record for a ticket
 */
paymentRouter.get("/:ticketId", async (req, res) => {
  try {
    const record = await paymentService.getByTicketId(req.params.ticketId);
    if (!record) {
      res.status(404).json({ error: "No payment record found for this ticket" });
      return;
    }
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: "Failed to get payment record" });
  }
});

/**
 * POST /api/payments/:id/sponge-execute
 * Execute a pending Sponge USDC transfer. Called after MCP transfer completes.
 * Body: { txHash?: string }
 */
paymentRouter.post("/:id/sponge-execute", async (req, res) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body || {};

    const payment = await paymentService.getById(id);
    if (!payment) {
      res.status(404).json({ error: "Payment record not found" });
      return;
    }

    // Mark as transferred
    await spongeService.markTransferred(id, txHash);

    // Update ticket
    const ticketId = payment.ticket_id;
    await ticketService.update(ticketId, {
      paymentStatus: "sponge_transferred",
    });

    await eventService.log({
      ticketId,
      eventType: "payment_transferred",
      actor: "system",
      data: { paymentId: id, txHash, method: "sponge", chain: process.env.SPONGE_CHAIN || "solana" },
      description: `USDC transfer sent on ${process.env.SPONGE_CHAIN || "solana"}${txHash ? ` (tx: ${txHash})` : ""}`,
    });

    res.json({ status: "transferred", paymentId: id, txHash });
  } catch (err) {
    res.status(500).json({ error: `Sponge execute failed: ${(err as Error).message}` });
  }
});

/**
 * POST /api/payments/:id/sponge-confirm
 * Confirm a Sponge payment is finalized. Completes the ticket.
 */
paymentRouter.post("/:id/sponge-confirm", async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await paymentService.getById(id);
    if (!payment) {
      res.status(404).json({ error: "Payment record not found" });
      return;
    }

    await spongeService.markConfirmed(id);

    const ticketId = payment.ticket_id;
    await ticketService.updateStatus(ticketId, "PAYMENT_COMPLETED", {
      paymentStatus: "paid",
    });

    await eventService.log({
      ticketId,
      eventType: "payment_completed",
      actor: "system",
      previousState: "PAYMENT_PENDING",
      newState: "PAYMENT_COMPLETED",
      data: { paymentId: id, method: "sponge" },
      description: `Sponge USDC payment confirmed on-chain`,
    });

    // Auto-complete ticket
    await ticketService.updateStatus(ticketId, "COMPLETED");
    await eventService.log({
      ticketId,
      eventType: "status_changed",
      actor: "system",
      previousState: "PAYMENT_COMPLETED",
      newState: "COMPLETED",
      description: "Ticket completed after Sponge payment confirmed",
    });

    // Save resolution to Supermemory for future context
    const ticket = await ticketService.getById(ticketId);
    if (ticket) {
      memoryService.saveTicketResolution({
        ticketId,
        category: ticket.classification?.category || "unknown",
        propertyUnitId: ticket.propertyUnitId,
        vendorId: ticket.assignedVendorId || "unknown",
        vendorName: ticket.assignedVendorId || "unknown",
        cost: ticket.paymentAmount,
        resolution: `${ticket.classification?.category} issue resolved. ${ticket.classification?.description || ticket.rawSubject}. Paid $${ticket.paymentAmount || 0} via Sponge USDC.`,
      }).catch((err) => console.warn(`[Memory] Save failed: ${err.message}`));
    }

    res.json({
      status: "confirmed",
      ticketId,
      amount: payment.amount / 100,
      message: "Sponge payment confirmed — ticket marked COMPLETED",
    });
  } catch (err) {
    res.status(500).json({ error: `Sponge confirm failed: ${(err as Error).message}` });
  }
});

/**
 * GET /api/payments/:id/sponge-status
 * Get Sponge payment status
 */
paymentRouter.get("/:id/sponge-status", async (req, res) => {
  try {
    const payment = await paymentService.getById(req.params.id);
    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    const isSponge = payment.payment_link_url?.startsWith("sponge://") || payment.currency === "usdc";
    res.json({
      id: payment.id,
      status: payment.status,
      method: isSponge ? "sponge" : "stripe",
      chain: isSponge ? (process.env.SPONGE_CHAIN || "solana") : null,
      vendorWallet: isSponge ? (process.env.SPONGE_DEFAULT_VENDOR_WALLET || null) : null,
      txHash: isSponge && payment.payment_link_url?.startsWith("https://solscan") ? payment.payment_link_url : null,
      amount: payment.amount / 100,
      currency: payment.currency,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get sponge status" });
  }
});

/**
 * POST /api/tickets/:id/approve-payment
 * Property manager approves a payment that requires approval
 */
paymentRouter.post("/tickets/:id/approve-payment", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { approvedBy } = req.body || {};
    const approver = approvedBy || "property_manager";

    const ticket = await ticketService.getById(ticketId);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    if (ticket.policyDecision !== "pending_approval") {
      res.status(400).json({ error: `Ticket policy is ${ticket.policyDecision}, not pending_approval` });
      return;
    }

    // Approve and create payment
    await ticketService.update(ticketId, {
      policyDecision: "approved",
      paymentApprovedBy: approver,
    });

    await eventService.log({
      ticketId,
      eventType: "payment_approved",
      actor: "property_manager",
      actorId: approver,
      data: { approver },
      description: `Payment approved by ${approver}`,
    });

    // Now create the payment link
    const DEMO_PAYMENT_AMOUNT = process.env.DEMO_PAYMENT_AMOUNT
      ? parseFloat(process.env.DEMO_PAYMENT_AMOUNT)
      : null;
    const costEstimate = DEMO_PAYMENT_AMOUNT ?? (ticket.classification?.estimatedCostMax || 0);
    const amountCents = Math.round(costEstimate * 100);

    const payment = await paymentService.createPaymentLink({
      ticketId,
      vendorId: ticket.assignedVendorId || "unknown",
      amount: amountCents,
      description: `Maintenance: ${ticket.classification?.category} — ${ticket.classification?.description || ticket.rawSubject}`,
    });

    await ticketService.update(ticketId, {
      status: "PAYMENT_PENDING",
      paymentStatus: "link_sent",
      paymentIntentId: payment.paymentIntentId ?? undefined,
      paymentAmount: costEstimate,
    });

    await eventService.log({
      ticketId,
      eventType: "payment_created",
      actor: "system",
      previousState: "SCHEDULED",
      newState: "PAYMENT_PENDING",
      data: { paymentId: payment.id, amount: amountCents, url: payment.paymentLinkUrl, mock: paymentService.isMock },
      description: `Payment link created: $${costEstimate.toFixed(2)} (${paymentService.isMock ? "mock" : "stripe"})`,
    });

    res.json({
      status: "approved",
      ticketId,
      payment: {
        id: payment.id,
        url: payment.paymentLinkUrl,
        amount: costEstimate,
        mock: paymentService.isMock,
      },
    });
  } catch (err) {
    res.status(500).json({ error: `Approval failed: ${(err as Error).message}` });
  }
});
