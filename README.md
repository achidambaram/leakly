# Leakly — Autonomous Maintenance Dispatcher

AI-powered property maintenance system. Tenant reports an issue → AI classifies it → vendor gets dispatched → repair gets scheduled → vendor gets paid in USDC → done.

## How It Works

```
Tenant (email or chat) → Gemini classifies → Supermemory checks history
    → Vendor selected & emailed → Vendor confirms → Browser Use books appointment
    → Sponge pays vendor in USDC → Ticket completed
```

## Tech Stack

| What | How |
|------|-----|
| Backend | TypeScript, Express |
| Frontend | React, Vite, Tailwind |
| Database | Supabase |
| AI | Gemini 2.5 Flash |
| Email | AgentMail |
| Memory | Supermemory |
| Payments | Sponge (USDC) + Stripe fallback |
| Browser Automation | Browser Use (via Sponge) |
| Realtime | WebSocket |

## Quick Start

```bash
# 1. Install
npm install && cd frontend && npm install && cd ..

# 2. Copy .env.example to .env and fill in your keys
cp .env.example .env

# 3. Run the SQL migration in Supabase Dashboard > SQL Editor
#    (paste contents of supabase-migration.sql)

# 4. Start
npm run dev:all
```

Open http://localhost:5173 — pick a role and go.

## Environment Variables

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
AGENTMAIL_API_KEY=
AGENTMAIL_INBOX=your_inbox@agentmail.to
GEMINI_API_KEY=
SUPERMEMORY_API_KEY=
SPONGE_ENABLED=true
SPONGE_API_KEY=
SPONGE_CHAIN=solana
SPONGE_DEFAULT_VENDOR_WALLET=
STRIPE_SECRET_KEY=          # optional, falls back to mock
BROWSER_USE_API_KEY=        # optional, enables portal booking
DEMO_PAYMENT_AMOUNT=0.50   # override payment amounts for demo
PORT=3001
```

## Three Views

| Role | URL | What they see |
|------|-----|---------------|
| Property Manager | `/dashboard` | All tickets, vendor management, predictive insights, memory chat |
| Tenant | `/tenant` | AI chat to report issues, track request status, payment receipts |
| Vendor | `/vendors` | Vendor list and assignments |

## Demo Walkthrough

**1. Report an issue** — Go to Tenant view, enter an email, describe the problem in chat. The AI asks follow-up questions, then auto-creates a ticket.

**2. Watch it process** — Switch to Property Manager view. The ticket moves through: classify → vendor select → vendor email → schedule → pay.

**3. Payment** — Click "Pay Vendor via Sponge" to send USDC. Transaction appears on Solscan.

**4. Insights** — Go to the Insights tab. AI analyzes all tickets + Supermemory history to detect patterns ("unit 1a has had 3 plumbing issues — recommend full inspection"). Click "Find Local Services" to search for vendors.

**5. Tenant tracking** — Tenant sees real-time progress bar, schedule, and on-chain payment receipt.

## Key Features

- **Autonomous dispatch** — email in, repair scheduled, vendor paid, zero manual steps
- **Sponge USDC payments** — vendors get paid on-chain, tenant sees tx proof on Solscan
- **Supermemory** — learns from every repair, detects recurring issues, briefs vendors on past history
- **Browser Use** — fills out vendor booking portals automatically (live iframe in dashboard)
- **Predictive maintenance** — AI spots patterns across units and recommends preventive action
- **Service discovery** — finds and compares local vendors via Google Search grounding
