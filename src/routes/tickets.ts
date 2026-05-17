import { Router } from "express";
import { z } from "zod/v4";
import { ticketService } from "../services/ticket.service.js";
import { eventService } from "../services/event.service.js";

export const ticketRouter = Router();

// Validation schemas
const createTicketSchema = z.object({
  tenantEmail: z.email(),
  tenantName: z.string().optional(),
  propertyUnitId: z.string().min(1),
  rawSubject: z.string().min(1),
  rawBody: z.string().min(1),
  externalEmailId: z.string().optional(),
});

const updateTicketSchema = z.object({
  status: z.enum([
    "NEW", "CLASSIFIED", "PRIORITIZED", "VENDOR_SELECTED",
    "VENDOR_CONTACTED", "AWAITING_VENDOR_RESPONSE", "SCHEDULED",
    "PAYMENT_PENDING", "PAYMENT_COMPLETED", "COMPLETED",
    "FAILED", "REQUIRES_HUMAN_INTERVENTION", "CANCELLED",
  ]).optional(),
  assignedVendorId: z.string().optional(),
  scheduledDate: z.string().optional(),
  scheduledTimeSlot: z.string().optional(),
  paymentStatus: z.enum(["none", "pending", "link_sent", "paid", "failed"]).optional(),
  failureReason: z.string().optional(),
  notes: z.array(z.string()).optional(),
});

// GET /api/tickets
ticketRouter.get("/", async (_req, res) => {
  try {
    const status = _req.query.status as string | undefined;
    const propertyUnitId = _req.query.propertyUnitId as string | undefined;
    const tickets = await ticketService.list({ status: status as any, propertyUnitId });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: "Failed to list tickets" });
  }
});

// GET /api/tickets/:id
ticketRouter.get("/:id", async (req, res) => {
  try {
    const ticket = await ticketService.getById(req.params.id);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: "Failed to get ticket" });
  }
});

// POST /api/tickets
ticketRouter.post("/", async (req, res) => {
  try {
    const parsed = createTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }

    const ticket = await ticketService.create(parsed.data);

    // Log the creation event
    await eventService.log({
      ticketId: ticket.id,
      eventType: "ticket_created",
      actor: "system",
      newState: "NEW",
      description: `Ticket created for ${parsed.data.tenantEmail}: ${parsed.data.rawSubject}`,
      data: { tenantEmail: parsed.data.tenantEmail, propertyUnitId: parsed.data.propertyUnitId },
    });

    res.status(201).json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create ticket" });
  }
});

// PATCH /api/tickets/:id
ticketRouter.patch("/:id", async (req, res) => {
  try {
    const parsed = updateTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }

    const existing = await ticketService.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const ticket = await ticketService.update(req.params.id, parsed.data);

    // Log status change if applicable
    if (parsed.data.status && parsed.data.status !== existing.status) {
      await eventService.log({
        ticketId: req.params.id,
        eventType: "status_changed",
        actor: "system",
        previousState: existing.status,
        newState: parsed.data.status,
        description: `Status changed from ${existing.status} to ${parsed.data.status}`,
      });
    }

    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

// GET /api/tickets/:id/events
ticketRouter.get("/:id/events", async (req, res) => {
  try {
    const events = await eventService.getByTicketId(req.params.id);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: "Failed to list events" });
  }
});
