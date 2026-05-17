import { Router } from "express";
import { eventService } from "../services/event.service.js";

export const eventRouter = Router();

// GET /api/events
eventRouter.get("/", async (_req, res) => {
  try {
    const limit = _req.query.limit ? parseInt(_req.query.limit as string, 10) : 50;
    const events = await eventService.list(limit);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: "Failed to list events" });
  }
});
