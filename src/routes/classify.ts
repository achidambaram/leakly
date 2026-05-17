import { Router } from "express";
import { z } from "zod/v4";
import { classificationService } from "../services/classification.service.js";
import { ticketService } from "../services/ticket.service.js";
import { eventService } from "../services/event.service.js";

export const classifyRouter = Router();

const classifySchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

// POST /api/classify — classify raw text
classifyRouter.post("/", async (req, res) => {
  try {
    const parsed = classifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }

    const classification = await classificationService.classify(parsed.data.subject, parsed.data.body);
    res.json(classification);
  } catch (err) {
    console.error("Classification error:", err);
    res.status(500).json({ error: "Classification failed" });
  }
});

// POST /api/classify/ticket/:id — classify and update an existing ticket
classifyRouter.post("/ticket/:id", async (req, res) => {
  try {
    const ticket = await ticketService.getById(req.params.id);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    if (ticket.status !== "NEW") {
      res.status(400).json({ error: `Ticket is in ${ticket.status} state, expected NEW` });
      return;
    }

    const classification = await classificationService.classify(ticket.rawSubject, ticket.rawBody);

    const nextStatus = classification.confidence > 0.5 ? "CLASSIFIED" : "REQUIRES_HUMAN_INTERVENTION";

    const updated = await ticketService.update(ticket.id, {
      classification,
      status: nextStatus as any,
    });

    await eventService.log({
      ticketId: ticket.id,
      eventType: "ai_classification",
      actor: "ai",
      previousState: "NEW",
      newState: nextStatus,
      description: `AI classified as ${classification.category} (${classification.urgency}, confidence: ${classification.confidence.toFixed(2)})`,
      data: classification as unknown as Record<string, unknown>,
    });

    res.json({ ticket: updated, classification });
  } catch (err) {
    console.error("Ticket classification error:", err);
    res.status(500).json({ error: "Classification failed" });
  }
});
