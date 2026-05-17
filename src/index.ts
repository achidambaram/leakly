import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { ticketRouter } from "./routes/tickets.js";
import { eventRouter } from "./routes/events.js";
import { vendorRouter } from "./routes/vendors.js";
import { classifyRouter } from "./routes/classify.js";
import { webhookRouter } from "./routes/webhooks.js";
import { orchestratorRouter } from "./routes/orchestrator.js";
import { paymentRouter } from "./routes/payments.js";
import { wsService } from "./services/ws.service.js";

// Run migrations on startup
import "./db/migrate.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/tickets", ticketRouter);
app.use("/api/events", eventRouter);
app.use("/api/vendors", vendorRouter);
app.use("/api/classify", classifyRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/orchestrator", orchestratorRouter);
app.use("/api/payments", paymentRouter);

const server = createServer(app);
wsService.init(server);

server.listen(PORT, () => {
  console.log(`Leakly API running on http://localhost:${PORT}`);
});
