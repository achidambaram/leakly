import { Router } from "express";
import { orchestratorService } from "../services/orchestrator.service.js";
import { browserService } from "../services/browser.service.js";
import { ticketService } from "../services/ticket.service.js";
import { vendorService } from "../services/vendor.service.js";
import { eventService } from "../services/event.service.js";
import { supabase } from "../db/index.js";

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

/**
 * POST /api/orchestrator/book-portal/:ticketId
 * Use Browser Use to book a vendor appointment via their online portal.
 * Provisions a cloud browser, fills the form, and extracts confirmation.
 */
orchestratorRouter.post("/book-portal/:ticketId", async (req, res) => {
  try {
    const { ticketId } = req.params;

    if (!browserService.isAvailable) {
      res.status(400).json({ error: "Browser Use API key not configured" });
      return;
    }

    const ticket = await ticketService.getById(ticketId);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    // Get property unit address
    const { data: unit } = await supabase
      .from("property_units")
      .select("*")
      .eq("id", ticket.propertyUnitId)
      .single();
    const address = unit
      ? `${unit.address}, Unit ${unit.unit_number}`
      : ticket.propertyUnitId;

    // Map category to issue type for the portal form
    const issueTypeMap: Record<string, string> = {
      plumbing: "leak",
      electrical: "other",
      hvac: "other",
      appliance: "other",
      structural: "other",
      pest: "other",
      general: "other",
    };
    const category = ticket.classification?.category || "other";
    const issueType = issueTypeMap[category] || "other";

    // Set preferred date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const preferredDate = tomorrow.toISOString().split("T")[0];

    await eventService.log({
      ticketId,
      eventType: "status_changed",
      actor: "system",
      data: { method: "browser_use" },
      description: "Initiating browser automation to book via vendor portal...",
    });

    // Return immediately — browser automation runs async
    res.json({
      status: "booking",
      ticketId,
      message: "Browser automation started. Watch the dashboard for updates.",
    });

    // Run browser automation in background
    const result = await browserService.bookViaPortal({
      issueType,
      address,
      description: ticket.classification?.description || ticket.rawBody,
      preferredDate,
      preferredTime: "10AM-12PM",
      contactEmail: ticket.tenantEmail,
      onLiveUrl: (url: string) => {
        eventService.log({
          ticketId,
          eventType: "status_changed",
          actor: "system",
          data: { method: "browser_use", liveUrl: url },
          description: `Browser automation running — watch live: ${url}`,
        });
      },
    });

    if (result.success) {
      await ticketService.update(ticketId, {
        status: "SCHEDULED",
        scheduledDate: result.scheduledDate ?? undefined,
        scheduledTimeSlot: result.scheduledTime ?? undefined,
      });

      await eventService.log({
        ticketId,
        eventType: "schedule_confirmed",
        actor: "system",
        previousState: "VENDOR_CONTACTED",
        newState: "SCHEDULED",
        data: {
          method: "browser_use",
          confirmationNumber: result.confirmationNumber,
          liveUrl: result.liveUrl,
        },
        description: `Booked via vendor portal (Browser Use). Confirmation: ${result.confirmationNumber}`,
      });

      // Trigger payment flow
      await orchestratorService.triggerPayment(ticketId, ticket);
    } else {
      await eventService.log({
        ticketId,
        eventType: "error",
        actor: "system",
        data: { method: "browser_use", error: result.error },
        description: `Browser automation failed: ${result.error}`,
      });
    }
  } catch (err) {
    console.error(`[Browser] Error:`, err);
    res.status(500).json({ error: `Portal booking failed: ${(err as Error).message}` });
  }
});
