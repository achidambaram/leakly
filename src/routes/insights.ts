import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { memoryService } from "../services/memory.service.js";
import { browserService } from "../services/browser.service.js";
import { supabase } from "../db/index.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const insightsRouter = Router();

/**
 * POST /api/insights/seed
 * Backfill all existing tickets into Supermemory so it has data to work with.
 */
insightsRouter.post("/seed", async (_req, res) => {
  try {
    const { data: tickets } = await supabase
      .from("tickets")
      .select("*")
      .order("created_at", { ascending: true });

    if (!tickets || tickets.length === 0) {
      res.json({ seeded: 0, message: "No tickets to seed." });
      return;
    }

    let seeded = 0;
    for (const t of tickets) {
      const c = t.classification || {};
      await memoryService.saveTicketResolution({
        ticketId: t.id,
        category: c.category || "unknown",
        propertyUnitId: t.property_unit_id || "unknown",
        vendorId: t.assigned_vendor_id || "unknown",
        vendorName: t.assigned_vendor_id || "unknown",
        cost: t.payment_amount,
        resolution: `${c.category || "maintenance"} issue at unit ${t.property_unit_id}. "${t.raw_subject}". ${c.description || t.raw_body || ""}. Status: ${t.status}. Cost: $${t.payment_amount || "N/A"}.`,
      });
      seeded++;
    }

    res.json({ seeded, message: `Seeded ${seeded} tickets into Supermemory.` });
  } catch (err) {
    res.status(500).json({ error: `Seed failed: ${(err as Error).message}` });
  }
});

const SPONGE_MCP_URL = "https://api.wallet.paysponge.com/mcp";
const SPONGE_API_KEY = process.env.SPONGE_API_KEY || "";

async function callSpongeMcp(toolName: string, args: Record<string, unknown>): Promise<any> {
  const { v4: uuid } = await import("uuid");
  const res = await fetch(SPONGE_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SPONGE_API_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuid(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  const json = await res.json() as any;
  if (json.error) throw new Error(JSON.stringify(json.error));
  const content = json.result?.content;
  if (content?.[0]?.type === "text") {
    try { return JSON.parse(content[0].text); } catch { return content[0].text; }
  }
  return json.result;
}

// In-memory store for service search results (populated by MCP agent_browse via /api/insights/find-services-result)
const serviceSearchResults: Record<string, any> = {};

/**
 * POST /api/insights/find-services-sync
 * Searches Yelp via Gemini with Google grounding for real local services.
 * Body: { category: string, recommendation: string, location?: string }
 */
insightsRouter.post("/find-services-sync", async (req, res) => {
  try {
    const { category, recommendation, location } = req.body;
    if (!category || !recommendation) {
      res.status(400).json({ error: "category and recommendation are required" });
      return;
    }

    const loc = location || "San Francisco Bay Area";
    const searchQuery = `best ${category} services near ${loc}`;

    // Use Gemini with search grounding to find real services with real URLs
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const searchPrompt = `Search Google for: "${searchQuery}"

Find 5 real ${category} companies in ${loc}. Look up each company individually and report their ACTUAL data from Google Maps or Yelp.

For each company return:
- "name": real business name
- "url": their real website URL, or Yelp page if no website
- "rating": their actual rating as shown on Google Maps (e.g. "4.8", "3.9")
- "reviews": actual review count as shown on Google Maps (e.g. "142 reviews")
- "estimatedCost": look up their actual service call fee or hourly rate from their website or Google listing. If not listed, say "Call for quote"
- "pros": array of 3 specific strengths based on real reviewer comments (e.g. ["Licensed and insured with 20+ years experience", "Offers free video pipe inspection with service call", "Same-day emergency availability"])
- "cons": array of 3 specific weaknesses based on real reviewer complaints (e.g. ["$89 service call fee is non-refundable", "No weekend appointments available", "Some reviewers report long hold times on phone"])

Also return:
- "topPick": { "name": string, "reason": string }
- "comparison": 2-sentence summary
- "suggestion": one actionable next step

The issue: ${category} — ${recommendation}

Only real businesses with real data. If you cannot find the actual rating or price, say so — do not guess or use placeholders.

Return ONLY valid JSON with keys: topPick, services, comparison, suggestion.`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: searchPrompt }] }],
      tools: [{ googleSearch: {} } as any],
    });

    let text = result.response.text().trim();
    // Strip markdown fences, thinking blocks, etc.
    text = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    let analysis: any = {};
    try {
      analysis = JSON.parse(text);
    } catch {
      // Try to find JSON object in the response
      const jsonMatch = text.match(/\{[\s\S]*"services"[\s\S]*\}/);
      if (jsonMatch) {
        try { analysis = JSON.parse(jsonMatch[0]); } catch {}
      }
    }
    if (!analysis.services || !Array.isArray(analysis.services)) {
      analysis = { services: [], comparison: "Could not parse results.", suggestion: "Try again." };
    }

    // Generate Google Maps links for every service
    if (analysis.services) {
      for (const svc of analysis.services) {
        svc.mapUrl = `https://www.google.com/maps/search/${encodeURIComponent(svc.name + " " + loc)}`;
      }
    }

    res.json({
      ...analysis,
      searchQuery,
      servicesFound: analysis.services?.length || 0,
    });
  } catch (err) {
    console.error("[Insights] Service search failed:", err);
    res.status(500).json({ error: `Search failed: ${(err as Error).message}` });
  }
});

/**
 * POST /api/insights/verify-links
 * Accepts verified website URLs from Browser Use agent.
 * Body: { services: [{ name: string, url: string }] }
 * Stores them so the frontend can fetch.
 */
let verifiedLinks: Record<string, string> = {};

insightsRouter.post("/verify-links", (req, res) => {
  const { services } = req.body;
  if (Array.isArray(services)) {
    for (const svc of services) {
      if (svc.name && svc.url) {
        verifiedLinks[svc.name.toLowerCase()] = svc.url;
      }
    }
  }
  res.json({ stored: Object.keys(verifiedLinks).length });
});

insightsRouter.get("/verified-links", (_req, res) => {
  res.json(verifiedLinks);
});

/**
 * POST /api/insights/analyze
 * Run predictive maintenance analysis across all properties.
 * Pulls all ticket data + Supermemory context, feeds to Gemini for pattern detection.
 */
insightsRouter.post("/analyze", async (_req, res) => {
  try {
    // 1. Get all tickets with resolutions
    const { data: tickets } = await supabase
      .from("tickets")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!tickets || tickets.length === 0) {
      res.json({ insights: [], summary: "No ticket data to analyze yet." });
      return;
    }

    // 2. Group by unit for pattern detection
    const unitGroups: Record<string, any[]> = {};
    for (const t of tickets) {
      const unit = t.property_unit_id || "unknown";
      if (!unitGroups[unit]) unitGroups[unit] = [];
      unitGroups[unit].push(t);
    }

    // 3. Query Supermemory for each unit with repeated issues
    const memoryResults: Record<string, string[]> = {};
    const unitsWithMultiple = Object.entries(unitGroups).filter(([, tix]) => tix.length >= 2);

    for (const [unitId, tix] of unitsWithMultiple) {
      const categories = [...new Set(tix.map((t) => t.classification?.category).filter(Boolean))];
      const memories = await memoryService.query(
        `unit ${unitId} recurring issues repairs ${categories.join(" ")}`
      );
      memoryResults[unitId] = memories.map((m) => m.content);
    }

    // 4. Also search for building-wide patterns
    const allCategories = [...new Set(tickets.map((t) => t.classification?.category).filter(Boolean))];
    const buildingMemories = await memoryService.query(
      `building-wide patterns recurring maintenance ${allCategories.join(" ")} multiple units same issue`
    );

    // 5. Build the analysis prompt
    const ticketSummaries = tickets.map((t) => {
      const c = t.classification || {};
      return `[${t.property_unit_id}] ${c.category || "unknown"} — "${t.raw_subject}" (${t.status}, cost: $${t.payment_amount || "N/A"}, ${new Date(t.created_at).toLocaleDateString()})`;
    }).join("\n");

    const memoryContext = Object.entries(memoryResults)
      .map(([unit, mems]) => `Unit ${unit}:\n${mems.map((m) => `  - ${m}`).join("\n")}`)
      .join("\n\n");

    const buildingContext = buildingMemories.length > 0
      ? buildingMemories.map((m) => `- ${m.content}`).join("\n")
      : "No building-wide patterns in memory yet.";

    const prompt = `You are a predictive maintenance analyst for a property management company. Analyze the maintenance history and identify actionable patterns.

TICKET HISTORY:
${ticketSummaries}

REPAIR MEMORY (from Supermemory — past resolutions and context):
${memoryContext || "No unit-specific memories yet."}

BUILDING-WIDE MEMORY:
${buildingContext}

Analyze this data and produce a JSON array of insights. Each insight should have:
- "type": "recurring_issue" | "escalation_risk" | "cost_saving" | "preventive_action" | "building_pattern"
- "severity": "info" | "warning" | "critical"
- "title": short headline (under 80 chars)
- "description": 2-3 sentence explanation with specific data references
- "affected": array of unit IDs or "building-wide"
- "recommendation": specific actionable next step
- "estimatedSavings": estimated cost savings if acted on (string like "$500-1000" or null)

Rules:
- Only report genuine patterns (2+ related incidents)
- Be specific — cite unit IDs, dates, categories, costs
- If a unit has repeated same-category issues, flag escalation risk
- If multiple units share the same issue type, check for building-wide root cause
- If repairs are getting more expensive over time, flag cost escalation
- If there's not enough data for a pattern, say so — don't make things up

Return ONLY a valid JSON array. No markdown, no explanation.`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();

    // Strip markdown code fences if present
    text = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

    let insights: any[] = [];
    try {
      insights = JSON.parse(text);
    } catch {
      console.warn("[Insights] Failed to parse Gemini response:", text.slice(0, 200));
      insights = [];
    }

    // 6. Save insights back to Supermemory for future reference
    if (insights.length > 0) {
      const insightSummary = insights
        .map((i: any) => `[${i.type}] ${i.title}: ${i.description}`)
        .join("\n");

      memoryService.saveTicketResolution({
        ticketId: `insights_${Date.now()}`,
        category: "predictive_analysis",
        propertyUnitId: "building-wide",
        vendorId: "system",
        vendorName: "Leakly AI",
        cost: null,
        resolution: `Predictive analysis run on ${new Date().toLocaleDateString()}. Found ${insights.length} pattern(s):\n${insightSummary}`,
      }).catch(() => {});
    }

    res.json({
      insights,
      analyzedTickets: tickets.length,
      unitsAnalyzed: Object.keys(unitGroups).length,
      memoriesUsed: Object.values(memoryResults).flat().length + buildingMemories.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Insights] Error:", err);
    res.status(500).json({ error: `Analysis failed: ${(err as Error).message}` });
  }
});
