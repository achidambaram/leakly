/**
 * Memory Service — Supermemory integration for context enrichment
 * Queries tenant history, unit history, vendor performance before decisions.
 */

import Supermemory from "supermemory";

const client = new Supermemory({
  apiKey: process.env.SUPERMEMORY_API_KEY!,
});

const CONTAINER_TAG = "leakly";

interface MemoryResult {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

interface TicketContext {
  tenantHistory: MemoryResult[];
  unitHistory: MemoryResult[];
  vendorPerformance: MemoryResult[];
}

async function search(query: string): Promise<MemoryResult[]> {
  try {
    const data = await client.search.memories({
      q: query,
      containerTag: CONTAINER_TAG,
      searchMode: "hybrid",
      limit: 5,
    });

    return (data.results || []).map((r: any) => ({
      id: r.id,
      content: r.memory || r.chunk || "",
      metadata: r.metadata ?? undefined,
      score: r.similarity,
    }));
  } catch (err) {
    console.warn(`[Memory] Search failed for "${query}": ${(err as Error).message}`);
    return [];
  }
}

export const memoryService = {
  async getTicketContext(params: {
    tenantEmail: string;
    propertyUnitId: string;
    category?: string;
  }): Promise<TicketContext> {
    // Run all queries in parallel with 3s timeout
    const timeout = (ms: number) =>
      new Promise<MemoryResult[]>((resolve) => setTimeout(() => resolve([]), ms));

    const [tenantHistory, unitHistory, vendorPerformance] = await Promise.all([
      Promise.race([
        search(`tenant ${params.tenantEmail} maintenance history`),
        timeout(3000),
      ]),
      Promise.race([
        search(`unit ${params.propertyUnitId} past issues ${params.category || ""}`),
        timeout(3000),
      ]),
      Promise.race([
        search(`vendor performance ${params.category || ""} reliability`),
        timeout(3000),
      ]),
    ]);

    return { tenantHistory, unitHistory, vendorPerformance };
  },

  async saveTicketResolution(params: {
    ticketId: string;
    category: string;
    propertyUnitId: string;
    vendorId: string;
    vendorName: string;
    cost: number | null;
    resolution: string;
  }): Promise<void> {
    const content = `Ticket ${params.ticketId}: ${params.category} issue at unit ${params.propertyUnitId}. Resolved by ${params.vendorName} (${params.vendorId}). Cost: $${params.cost ?? "N/A"}. ${params.resolution}`;

    try {
      await client.add({
        content,
        containerTag: CONTAINER_TAG,
        customId: `ticket_${params.ticketId}`,
        metadata: {
          type: "unit_history",
          unitId: params.propertyUnitId,
          category: params.category,
          vendorId: params.vendorId,
          resolvedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.warn(`[Memory] Save failed for ticket ${params.ticketId}: ${(err as Error).message}`);
    }
  },
};
