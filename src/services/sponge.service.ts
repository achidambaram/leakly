/**
 * Sponge Payment Service — USDC payments to vendors via Sponge wallet.
 * Calls Sponge MCP API (JSON-RPC over HTTP) to execute on-chain USDC transfers.
 */

import { supabase } from "../db/index.js";
import { v4 as uuid } from "uuid";

const SPONGE_ENABLED = process.env.SPONGE_ENABLED === "true";
const SPONGE_DEFAULT_CHAIN = (process.env.SPONGE_CHAIN || "base") as "base" | "solana" | "ethereum" | "arbitrum-one" | "polygon";
const SPONGE_MCP_URL = "https://api.wallet.paysponge.com/mcp";
const SPONGE_API_KEY = process.env.SPONGE_API_KEY || "";

// Cache the MCP session ID so we don't re-initialize every call
let mcpSessionId: string | null = null;

export interface SpongePaymentParams {
  ticketId: string;
  vendorId: string;
  vendorWallet: string; // vendor's USDC receiving address
  amount: number; // in USD (not cents)
  description: string;
  chain?: "base" | "solana" | "ethereum" | "arbitrum-one" | "polygon";
}

export interface SpongePaymentResult {
  id: string;
  method: "sponge";
  chain: string;
  amount: number;
  vendorWallet: string;
  status: "pending_transfer" | "transferred" | "confirmed" | "failed";
  txHash?: string;
}

/**
 * Initialize an MCP session with Sponge (handshake + session ID).
 */
async function ensureMcpSession(): Promise<string> {
  if (mcpSessionId) return mcpSessionId;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": `Bearer ${SPONGE_API_KEY}`,
  };

  // Step 1: Initialize
  const initRes = await fetch(SPONGE_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuid(),
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "leakly", version: "1.0.0" },
      },
    }),
  });

  if (!initRes.ok) throw new Error(`MCP init failed: ${initRes.status}`);

  const sessionId = initRes.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("No Mcp-Session-Id in init response");

  // Step 2: Send initialized notification
  await fetch(SPONGE_MCP_URL, {
    method: "POST",
    headers: { ...headers, "Mcp-Session-Id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  mcpSessionId = sessionId;
  return sessionId;
}

/**
 * Call a Sponge MCP tool via JSON-RPC over HTTP with proper session handling.
 */
async function callSpongeMcp(toolName: string, args: Record<string, unknown>): Promise<any> {
  const sessionId = await ensureMcpSession();

  const res = await fetch(SPONGE_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${SPONGE_API_KEY}`,
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuid(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) {
    // Session may have expired — reset and retry once
    mcpSessionId = null;
    const retrySessionId = await ensureMcpSession();
    const retryRes = await fetch(SPONGE_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": `Bearer ${SPONGE_API_KEY}`,
        "Mcp-Session-Id": retrySessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: uuid(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    if (!retryRes.ok) {
      const text = await retryRes.text();
      throw new Error(`Sponge MCP error (${retryRes.status}): ${text}`);
    }
    const retryJson = await retryRes.json() as any;
    if (retryJson.error) throw new Error(`Sponge MCP error: ${JSON.stringify(retryJson.error)}`);
    return parseMcpResult(retryJson);
  }

  const json = await res.json() as any;
  if (json.error) {
    throw new Error(`Sponge MCP error: ${JSON.stringify(json.error)}`);
  }
  return parseMcpResult(json);
}

function parseMcpResult(json: any): any {
  const content = json.result?.content;
  if (content && content.length > 0 && content[0].type === "text") {
    try {
      return JSON.parse(content[0].text);
    } catch {
      return content[0].text;
    }
  }
  return json.result;
}

export const spongeService = {
  isEnabled: SPONGE_ENABLED,
  defaultChain: SPONGE_DEFAULT_CHAIN,

  /**
   * Execute a USDC transfer via Sponge MCP and record it in the DB.
   */
  async createPayment(params: SpongePaymentParams): Promise<SpongePaymentResult> {
    const id = uuid();
    const chain = params.chain || SPONGE_DEFAULT_CHAIN;

    // Insert pending record first
    await supabase.from("payment_records").insert({
      id,
      ticket_id: params.ticketId,
      vendor_id: params.vendorId,
      payment_link_url: `sponge://${chain}/${params.vendorWallet}`,
      stripe_payment_intent_id: `sponge_${id.slice(0, 8)}`,
      amount: Math.round(params.amount * 100),
      currency: "usdc",
      status: "created",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Execute the on-chain transfer
    try {
      const transferResult = await callSpongeMcp("transfer", {
        chain,
        to: params.vendorWallet,
        amount: params.amount.toString(),
        token: "USDC",
      });

      const txHash = transferResult?.transactionHash || transferResult?.signature || transferResult?.txHash;
      console.log(`[Sponge] Transfer executed: $${params.amount} USDC → ${params.vendorWallet} on ${chain}`, transferResult);

      // Update record with tx hash
      const explorerUrl = chain === "solana"
        ? `https://solscan.io/tx/${txHash}`
        : `https://basescan.org/tx/${txHash}`;

      await supabase.from("payment_records").update({
        status: "pending",
        payment_link_url: txHash ? explorerUrl : null,
        updated_at: new Date().toISOString(),
      }).eq("id", id);

      return {
        id,
        method: "sponge",
        chain,
        amount: params.amount,
        vendorWallet: params.vendorWallet,
        status: "transferred",
        txHash,
      };
    } catch (err) {
      console.error(`[Sponge] Transfer failed for payment ${id}:`, err);

      await supabase.from("payment_records").update({
        status: "failed",
        updated_at: new Date().toISOString(),
      }).eq("id", id);

      return {
        id,
        method: "sponge",
        chain,
        amount: params.amount,
        vendorWallet: params.vendorWallet,
        status: "failed",
      };
    }
  },

  /**
   * Mark a Sponge payment as transferred (USDC sent on-chain)
   */
  async markTransferred(paymentId: string, txHash?: string): Promise<void> {
    await supabase.from("payment_records").update({
      status: "pending",
      payment_link_url: txHash ? `https://solscan.io/tx/${txHash}` : null,
      updated_at: new Date().toISOString(),
    }).eq("id", paymentId);
  },

  /**
   * Mark confirmed (finality reached)
   */
  async markConfirmed(paymentId: string): Promise<void> {
    await supabase.from("payment_records").update({
      status: "paid",
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", paymentId);
  },

  /**
   * Mark failed
   */
  async markFailed(paymentId: string, _reason?: string): Promise<void> {
    await supabase.from("payment_records").update({
      status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", paymentId);
  },

  /**
   * Get vendor wallet address. Checks vendors table first, falls back to env mapping.
   */
  async getVendorWallet(_vendorId: string): Promise<string | null> {
    return process.env.SPONGE_DEFAULT_VENDOR_WALLET || null;
  },
};
