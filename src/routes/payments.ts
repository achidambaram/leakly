import { Router } from "express";
import { paymentService } from "../services/payment.service.js";
import { ticketService } from "../services/ticket.service.js";
import { eventService } from "../services/event.service.js";

export const paymentRouter = Router();

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
    const costEstimate = ticket.classification?.estimatedCostMax || 0;
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
      paymentIntentId: payment.paymentIntentId,
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
