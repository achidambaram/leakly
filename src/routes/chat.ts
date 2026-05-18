import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { memoryService } from "../services/memory.service.js";
import { supabase } from "../db/index.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const chatRouter = Router();

/**
 * POST /api/chat
 * AI assistant powered by Supermemory — answers questions about maintenance history.
 * Body: { message: string }
 */
chatRouter.post("/", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    // 1. Search Supermemory for relevant memories
    const memories = await memoryService.query(message);

    // 2. Also get current ticket stats from DB for grounding
    const { data: tickets } = await supabase
      .from("tickets")
      .select("status, classification, assigned_vendor_id, property_unit_id, payment_amount, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    const stats = {
      total: tickets?.length || 0,
      completed: tickets?.filter((t) => t.status === "COMPLETED").length || 0,
      active: tickets?.filter((t) => !["COMPLETED", "FAILED", "CANCELLED"].includes(t.status)).length || 0,
      categories: [...new Set(tickets?.map((t) => t.classification?.category).filter(Boolean))],
      totalSpend: tickets?.reduce((sum, t) => sum + (t.payment_amount || 0), 0) || 0,
    };

    // 3. Build context for Gemini
    const memoryContext = memories.length > 0
      ? memories.map((m) => `- ${m.content}`).join("\n")
      : "No relevant past records found.";

    const prompt = `You are an AI maintenance assistant for Leakly, a property management system. Answer the user's question using the maintenance history and current data provided.

Be concise and specific. If the data doesn't contain enough info to answer, say so honestly.

Current ticket stats:
- Total tickets: ${stats.total} (${stats.completed} completed, ${stats.active} active)
- Categories seen: ${stats.categories.join(", ") || "none"}
- Total spend: $${stats.totalSpend}

Relevant maintenance history from Supermemory:
${memoryContext}

User question: ${message}`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    res.json({
      answer,
      sources: memories.map((m) => ({
        content: m.content,
        score: m.score,
        metadata: m.metadata,
      })),
      stats,
    });
  } catch (err) {
    console.error("[Chat] Error:", err);
    res.status(500).json({ error: `Chat failed: ${(err as Error).message}` });
  }
});
