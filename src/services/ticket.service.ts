import { supabase } from "../db/index.js";
import { v4 as uuid } from "uuid";

export type TicketStatus =
  | "NEW" | "CLASSIFIED" | "PRIORITIZED" | "VENDOR_SELECTED"
  | "VENDOR_CONTACTED" | "AWAITING_VENDOR_RESPONSE" | "SCHEDULED"
  | "PAYMENT_PENDING" | "PAYMENT_COMPLETED" | "COMPLETED"
  | "FAILED" | "REQUIRES_HUMAN_INTERVENTION" | "CANCELLED";

export interface CreateTicketInput {
  tenantEmail: string;
  tenantName?: string;
  propertyUnitId: string;
  rawSubject: string;
  rawBody: string;
  externalEmailId?: string;
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  classification?: any;
  assignedVendorId?: string;
  vendorContactedAt?: string;
  vendorRespondedAt?: string;
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  paymentStatus?: string;
  paymentIntentId?: string;
  paymentAmount?: number;
  paymentMethod?: string;
  paymentApprovedBy?: string;
  policyDecision?: string;
  retryCount?: number;
  failureReason?: string;
  notes?: string[];
}

// Map camelCase to snake_case for DB
function toSnake(input: Record<string, any>): Record<string, any> {
  const map: Record<string, string> = {
    tenantEmail: "tenant_email",
    tenantName: "tenant_name",
    propertyUnitId: "property_unit_id",
    rawSubject: "raw_subject",
    rawBody: "raw_body",
    externalEmailId: "external_email_id",
    assignedVendorId: "assigned_vendor_id",
    vendorContactedAt: "vendor_contacted_at",
    vendorRespondedAt: "vendor_responded_at",
    scheduledDate: "scheduled_date",
    scheduledTimeSlot: "scheduled_time_slot",
    paymentStatus: "payment_status",
    paymentIntentId: "payment_intent_id",
    paymentAmount: "payment_amount",
    paymentApprovedBy: "payment_approved_by",
    policyDecision: "policy_decision",
    retryCount: "retry_count",
    failureReason: "failure_reason",
    createdAt: "created_at",
    updatedAt: "updated_at",
  };
  // Fields that are already snake_case or same in DB
  const passthrough = new Set(["status", "classification", "notes"]);
  // Fields to skip (not in DB schema)
  const skip = new Set(["paymentMethod"]);
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (skip.has(key)) continue;
    if (passthrough.has(key)) {
      result[key] = value;
    } else if (map[key]) {
      result[map[key]] = value;
    }
  }
  return result;
}

// Map snake_case DB row to camelCase
function toCamel(row: any): any {
  if (!row) return null;
  return {
    id: row.id,
    externalEmailId: row.external_email_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tenantEmail: row.tenant_email,
    tenantName: row.tenant_name,
    propertyUnitId: row.property_unit_id,
    rawSubject: row.raw_subject,
    rawBody: row.raw_body,
    classification: row.classification,
    assignedVendorId: row.assigned_vendor_id,
    vendorContactedAt: row.vendor_contacted_at,
    vendorRespondedAt: row.vendor_responded_at,
    scheduledDate: row.scheduled_date,
    scheduledTimeSlot: row.scheduled_time_slot,
    paymentStatus: row.payment_status,
    paymentIntentId: row.payment_intent_id,
    paymentAmount: row.payment_amount,
    paymentApprovedBy: row.payment_approved_by,
    policyDecision: row.policy_decision,
    retryCount: row.retry_count,
    failureReason: row.failure_reason,
    notes: row.notes,
  };
}

export const ticketService = {
  toCamel,

  async create(input: CreateTicketInput) {
    const now = new Date().toISOString();
    const id = uuid();

    const row = {
      id,
      ...toSnake(input),
      status: "NEW",
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await supabase.from("tickets").insert(row).select().single();
    if (error) throw new Error(`Create ticket failed: ${error.message}`);
    return toCamel(data);
  },

  async getById(id: string) {
    const { data, error } = await supabase.from("tickets").select("*").eq("id", id).single();
    if (error) return null;
    return toCamel(data);
  },

  async list(filters?: { status?: TicketStatus; propertyUnitId?: string }) {
    let query = supabase.from("tickets").select("*").order("created_at", { ascending: false });

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }
    if (filters?.propertyUnitId) {
      query = query.eq("property_unit_id", filters.propertyUnitId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`List tickets failed: ${error.message}`);
    return (data || []).map(toCamel);
  },

  async update(id: string, input: UpdateTicketInput) {
    const now = new Date().toISOString();
    const updates = { ...toSnake(input), updated_at: now };

    const { data, error } = await supabase.from("tickets").update(updates).eq("id", id).select().single();
    if (error) throw new Error(`Update ticket failed: ${error.message}`);
    return toCamel(data);
  },

  async updateStatus(id: string, newStatus: TicketStatus, metadata?: Partial<UpdateTicketInput>) {
    return this.update(id, { ...metadata, status: newStatus });
  },
};
