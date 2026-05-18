import { supabase } from "../db/index.js";
import { v4 as uuid } from "uuid";
import { wsService } from "./ws.service.js";

export type EventType =
  | "ticket_created" | "email_received" | "email_sent"
  | "ai_classification" | "memory_lookup" | "vendor_selected"
  | "vendor_contacted" | "vendor_responded" | "schedule_confirmed"
  | "tenant_availability_requested" | "tenant_availability_received"
  | "payment_created" | "payment_approved" | "payment_transferred" | "payment_completed"
  | "payment_failed" | "status_changed" | "manual_override"
  | "error" | "retry" | "escalation";

export type Actor = "system" | "ai" | "property_manager" | "tenant" | "vendor";

export interface CreateEventInput {
  ticketId: string;
  eventType: EventType;
  actor: Actor;
  actorId?: string;
  previousState?: string;
  newState?: string;
  data?: Record<string, unknown>;
  description: string;
}

function toCamel(row: any): any {
  if (!row) return null;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    actor: row.actor,
    actorId: row.actor_id,
    previousState: row.previous_state,
    newState: row.new_state,
    data: row.data,
    description: row.description,
  };
}

export const eventService = {
  async log(input: CreateEventInput) {
    const id = uuid();
    const now = new Date().toISOString();

    const row = {
      id,
      ticket_id: input.ticketId,
      timestamp: now,
      event_type: input.eventType,
      actor: input.actor,
      actor_id: input.actorId ?? null,
      previous_state: input.previousState ?? null,
      new_state: input.newState ?? null,
      data: input.data ?? {},
      description: input.description,
    };

    const { data, error } = await supabase.from("event_logs").insert(row).select().single();
    if (error) throw new Error(`Log event failed: ${error.message}`);

    // Broadcast via WebSocket
    wsService.broadcast({
      type: "ticket_event",
      ticketId: input.ticketId,
      data: { eventType: input.eventType, newState: input.newState, description: input.description },
    });

    return toCamel(data);
  },

  async getByTicketId(ticketId: string) {
    const { data, error } = await supabase
      .from("event_logs")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("timestamp", { ascending: false });

    if (error) throw new Error(`Get events failed: ${error.message}`);
    return (data || []).map(toCamel);
  },

  async list(limit = 50) {
    const { data, error } = await supabase
      .from("event_logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`List events failed: ${error.message}`);
    return (data || []).map(toCamel);
  },
};
