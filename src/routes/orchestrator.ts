import { Router } from "express";
import { orchestratorService } from "../services/orchestrator.service.js";

export const orchestratorRouter = Router();

/**
 * POST /api/orchestrator/process/:ticketId
 * Manually trigger orchestration for an existing ticket (useful for testing/retries)
 */
orchestratorRouter.post("/process/:ticketId", async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Run async — return immediately
    orchestratorService.processNewTicket(ticketId).catch((err) => {
      console.error(`[Orchestrator] Error processing ${ticketId}:`, err);
    });

    res.json({ status: "processing", ticketId });
  } catch (err) {
    res.status(500).json({ error: "Failed to trigger orchestration" });
  }
});

/**
 * POST /api/orchestrator/inbox
 * Ensure system inbox exists and return its address
 */
orchestratorRouter.post("/inbox", async (_req, res) => {
  try {
    const inbox = await orchestratorService.ensureInbox();
    res.json(inbox);
  } catch (err) {
    res.status(500).json({ error: `Failed to ensure inbox: ${(err as Error).message}` });
  }
});

/**
 * POST /api/orchestrator/check-timeouts
 * Check for vendor contact timeouts and trigger retries
 */
orchestratorRouter.post("/check-timeouts", async (_req, res) => {
  try {
    const result = await orchestratorService.checkTimeouts();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Timeout check failed: ${(err as Error).message}` });
  }
});
