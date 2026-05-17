/**
 * WebSocket Service — Broadcasts ticket state changes to connected clients
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

let wss: WebSocketServer | null = null;

export const wsService = {
  init(server: Server) {
    wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", (ws) => {
      console.log("[WS] Client connected");
      ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));

      ws.on("close", () => {
        console.log("[WS] Client disconnected");
      });
    });

    console.log("[WS] WebSocket server ready on /ws");
  },

  broadcast(event: { type: string; ticketId?: string; data?: unknown }) {
    if (!wss) return;
    const msg = JSON.stringify(event);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  },
};
