/**
 * Payment Service — Stripe + Sponge (USDC) integration for payment links and tracking.
 * Uses Stripe Checkout Sessions for payment link generation.
 * Uses Sponge for autonomous USDC payments to vendors.
 * Falls back to mock mode if neither is configured.
 */

import Stripe from "stripe";
import { supabase } from "../db/index.js";
import { v4 as uuid } from "uuid";
import { spongeService } from "./sponge.service.js";

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
  spongeEnabled: spongeService.isEnabled,

  /**
   * Determine the preferred payment method for a given ticket.
   * Sponge (USDC) is preferred for auto-approved payments when enabled and vendor has a wallet.
   */
  async getPreferredMethod(vendorId: string): Promise<"sponge" | "stripe" | "mock"> {
    if (spongeService.isEnabled) {
      const wallet = await spongeService.getVendorWallet(vendorId);
      if (wallet) return "sponge";
    }
    return IS_MOCK ? "mock" : "stripe";
  },

  /**
   * Create a Sponge USDC payment to a vendor and execute the on-chain transfer.
   */
  async createSpongePayment(params: CreatePaymentParams & { vendorWallet: string; chain?: string }): Promise<PaymentResult & { transferStatus: string; txHash?: string }> {
    const amountUsd = params.amount / 100; // convert cents to dollars
    const result = await spongeService.createPayment({
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      vendorWallet: params.vendorWallet,
      amount: amountUsd,
      description: params.description,
      chain: params.chain as any,
    });

    return {
      id: result.id,
      paymentLinkUrl: `${BASE_URL}/api/payments/${result.id}/sponge-status`,
      paymentIntentId: `sponge_${result.id.slice(0, 8)}`,
      status: result.status === "transferred" ? "paid" : result.status === "failed" ? "failed" : "pending",
      transferStatus: result.status,
      txHash: result.txHash,
    };
  },

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
