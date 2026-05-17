/**
 * Payment Service — Stripe integration for payment links and tracking.
 * Uses Stripe Checkout Sessions for payment link generation.
 * Falls back to mock mode if Stripe key is not configured.
 */

import Stripe from "stripe";
import { supabase } from "../db/index.js";
import { v4 as uuid } from "uuid";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const IS_MOCK = !STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.startsWith("your_");
const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

const stripe = IS_MOCK ? null : new Stripe(STRIPE_SECRET_KEY);

export interface CreatePaymentParams {
  ticketId: string;
  vendorId: string;
  amount: number; // in cents
  description: string;
}

export interface PaymentResult {
  id: string;
  paymentLinkUrl: string;
  paymentIntentId: string | null;
  status: "created" | "pending" | "paid" | "failed";
}

export const paymentService = {
  isMock: IS_MOCK,

  async createPaymentLink(params: CreatePaymentParams): Promise<PaymentResult> {
    const id = uuid();

    if (IS_MOCK) {
      // Mock mode — generate a fake payment link for demo
      const mockUrl = `${BASE_URL}/api/payments/${id}/simulate-pay`;
      const mockIntentId = `mock_pi_${id.slice(0, 8)}`;

      await supabase.from("payment_records").insert({
        id,
        ticket_id: params.ticketId,
        vendor_id: params.vendorId,
        stripe_payment_intent_id: mockIntentId,
        payment_link_url: mockUrl,
        amount: params.amount,
        currency: "usd",
        status: "created",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return {
        id,
        paymentLinkUrl: mockUrl,
        paymentIntentId: mockIntentId,
        status: "created",
      };
    }

    // Real Stripe mode
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: params.amount,
            product_data: { name: params.description },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      metadata: {
        ticketId: params.ticketId,
        vendorId: params.vendorId,
        paymentRecordId: id,
      },
      success_url: `${BASE_URL}/api/tickets/${params.ticketId}?payment=success`,
      cancel_url: `${BASE_URL}/api/tickets/${params.ticketId}?payment=cancelled`,
    });

    await supabase.from("payment_records").insert({
      id,
      ticket_id: params.ticketId,
      vendor_id: params.vendorId,
      stripe_payment_intent_id: session.payment_intent as string,
      stripe_invoice_id: null,
      payment_link_url: session.url!,
      amount: params.amount,
      currency: "usd",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return {
      id,
      paymentLinkUrl: session.url!,
      paymentIntentId: session.payment_intent as string,
      status: "pending",
    };
  },

  async markPaid(paymentId: string): Promise<void> {
    await supabase.from("payment_records").update({
      status: "paid",
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", paymentId);
  },

  async markFailed(paymentId: string): Promise<void> {
    await supabase.from("payment_records").update({
      status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", paymentId);
  },

  async getByTicketId(ticketId: string) {
    const { data } = await supabase.from("payment_records").select("*").eq("ticket_id", ticketId).single();
    return data ?? null;
  },

  async getById(id: string) {
    const { data } = await supabase.from("payment_records").select("*").eq("id", id).single();
    return data ?? null;
  },
};
