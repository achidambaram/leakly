import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { memoryService } from "../services/memory.service.js";
import { ticketService } from "../services/ticket.service.js";
import { orchestratorService } from "../services/orchestrator.service.js";
import { eventService } from "../services/event.service.js";
import { supabase } from "../db/index.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const tenantChatRouter = Router();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * POST /api/tenant-chat
 * Conversational intake for tenants. Supermemory provides unit/tenant history.
 * When the issue is clear, auto-creates a ticket with full context.
 *
 * Body: { email: string, message: string, history: ChatMessage[] }
 */
tenantChatRouter.post("/", async (req, res) => {
  try {
    const { email, message, history = [] } = req.body;
    if (!email || !message) {
      res.status(400).json({ error: "email and message are required" });
      return;
    }

    // 1. Look up tenant's unit
    const { data: pastTickets } = await supabase
      .from("tickets")
      .select("property_unit_id, raw_subject, status, classification, created_at")
      .eq("tenant_email", email)
      .order("created_at", { ascending: false })
      .limit(5);

    const unitId = pastTickets?.[0]?.property_unit_id || "unknown";

    // 2. Query Supermemory for relevant context
    const memories = await memoryService.query(
      `${email} ${unitId} ${message}`
    );

    const memoryContext = memories.length > 0
      ? memories.map((m) => `- ${m.content}`).join("\n")
      : "No prior maintenance history found for this tenant/unit.";

    const pastTicketSummary = pastTickets && pastTickets.length > 0
      ? pastTickets.map((t) =>
          `- ${t.raw_subject} (${t.status}, ${t.classification?.category || "unknown"}, ${new Date(t.created_at).toLocaleDateString()})`
        ).join("\n")
      : "No previous tickets.";

    // 3. Build conversation for Gemini
    const systemPrompt = `You are Leakly's maintenance assistant helping a tenant report and track issues. You have access to their maintenance history via Supermemory.

TENANT: ${email}
UNIT: ${unitId}

MAINTENANCE HISTORY (from Supermemory):
${memoryContext}

RECENT TICKETS:
${pastTicketSummary}

YOUR BEHAVIOR:
- Be friendly, concise, and helpful.
- If the tenant describes an issue, ask clarifying questions (location in unit, when it started, severity).
- Reference past issues when relevant: "I see we fixed a similar issue before..."
- When you have enough info to create a ticket (issue type, description, location), respond with your message AND include a JSON block at the end:
  |||TICKET|||{"subject":"short title","description":"full description with context","category":"plumbing|electrical|hvac|appliance|structural|pest|general","urgency":"low|medium|high|emergency"}|||END|||
- Only create the ticket when you have a clear issue. Don't rush — ask follow-up questions first.
- If referencing past repairs, mention what was done and suggest the vendor check related areas.`;

    const chatHistory = history.map((m: ChatMessage) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: "Understood. I'm ready to help the tenant with their maintenance needs, using their history from Supermemory for context." }] },
        ...chatHistory,
      ],
    });

    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    // 4. Check if the AI decided to create a ticket
    let ticketCreated = null;
    const ticketMatch = reply.match(/\|\|\|TICKET\|\|\|(.*?)\|\|\|END\|\|\|/s);

    if (ticketMatch) {
      try {
        const ticketData = JSON.parse(ticketMatch[1]);

        // Create the ticket
        const ticket = await ticketService.create({
          tenantEmail: email,
          tenantName: null,
          propertyUnitId: unitId,
          rawSubject: ticketData.subject,
          rawBody: ticketData.description,
        });

        await eventService.log({
          ticketId: ticket.id,
          eventType: "ticket_created",
          actor: "tenant",
          data: {
            source: "chat",
            memoryContextUsed: memories.length > 0,
            memoriesFound: memories.length,
          },
          description: `Ticket created via tenant chat (Supermemory context: ${memories.length} records)`,
        });

        // Start processing async
        orchestratorService.processNewTicket(ticket.id).catch((err) => {
          console.error(`[TenantChat] Orchestration error for ${ticket.id}:`, err);
        });

        ticketCreated = {
          id: ticket.id,
          subject: ticketData.subject,
          trackingUrl: `/track/${ticket.id}`,
        };
      } catch (parseErr) {
        console.warn("[TenantChat] Failed to parse ticket JSON:", parseErr);
      }
    }

    // Clean the reply — remove the ticket JSON block
    const cleanReply = reply.replace(/\|\|\|TICKET\|\|\|.*?\|\|\|END\|\|\|/s, "").trim();

    res.json({
      reply: cleanReply,
      ticketCreated,
      memoryUsed: memories.length > 0,
      memoriesFound: memories.length,
    });
  } catch (err) {
    console.error("[TenantChat] Error:", err);
    res.status(500).json({ error: `Chat failed: ${(err as Error).message}` });
  }
});
