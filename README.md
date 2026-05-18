# Leakly — Autonomous Maintenance Dispatcher

AI-powered property maintenance system that handles the entire repair lifecycle autonomously. A tenant reports an issue via email or chat, AI classifies it, a vendor gets dispatched and emailed, the repair is scheduled, and the vendor gets paid in USDC on-chain. Zero manual steps.

## Architecture

```
Tenant (email/chat)
  │
  ▼
AgentMail inbox receives email
  │
  ▼
Gemini 2.5 Flash classifies issue (category, urgency, cost estimate)
  │
  ▼
Policy engine evaluates (auto-approve if under threshold)
  │
  ▼
Supermemory checks unit/tenant history for recurring issues
  │
  ▼
Vendor selected by specialty + rating + availability
  │
  ▼
AgentMail sends dispatch email to vendor
  │
  ▼
Browser Use books appointment on vendor portal (automated form fill)
  │
  ▼
Sponge sends USDC payment to vendor wallet on Solana
  │
  ▼
Ticket marked COMPLETED — tenant sees on-chain receipt
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | TypeScript, Express, Node.js |
| Frontend | React 19, Vite, Tailwind CSS v4 |
| Database | Supabase (PostgreSQL + Realtime) |
| AI Classification | Google Gemini 2.5 Flash |
| Email | AgentMail (MCP) |
| Memory / Context | Supermemory |
| Payments | Sponge (USDC on Solana) with Stripe fallback |
| Browser Automation | Browser Use (cloud browser via Sponge) |
| Realtime Updates | WebSocket + Supabase Realtime |

---

## Setup

### Prerequisites

- **Node.js** v20 or later
- A **Supabase** account (free tier works) — [supabase.com](https://supabase.com)
- A **Google Gemini** API key — [aistudio.google.com](https://aistudio.google.com/apikey)

All other services (AgentMail, Supermemory, Sponge, Browser Use, Stripe) are optional and degrade gracefully. The app runs a full demo with just Supabase + Gemini.

### Step 1: Clone and install

```bash
git clone <repo-url> && cd Leakly

# Install backend + frontend dependencies in one command
npm install && cd frontend && npm install && cd ..
```

### Step 2: Set up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project (free tier)
2. Once the project is ready, go to **SQL Editor** (left sidebar)
3. Paste the entire contents of `supabase-migration.sql` and click **Run**
   - This creates all tables (tickets, vendors, property_units, etc.) and seeds demo data (3 units, 5 vendors)
4. Go to **Settings > API** and copy these three values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **service_role key** (under "Project API keys", the `service_role` one — NOT the anon key)
   - **anon key** (the `anon` / `public` one)

### Step 3: Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```env
# ── REQUIRED ──────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # from Supabase Settings > API
SUPABASE_ANON_KEY=eyJ...                # from Supabase Settings > API
GEMINI_API_KEY=AIza...                  # from aistudio.google.com

# ── OPTIONAL (features degrade gracefully without these) ──
AGENTMAIL_API_KEY=                      # enables real email dispatch
AGENTMAIL_INBOX=                        # inbox address for sending
SUPERMEMORY_API_KEY=                    # enables history/context lookup
SPONGE_ENABLED=true                    # enable USDC payments
SPONGE_API_KEY=                        # Sponge wallet API key
SPONGE_CHAIN=solana                    # chain for payments
SPONGE_DEFAULT_VENDOR_WALLET=          # vendor's USDC wallet address
STRIPE_SECRET_KEY=                     # falls back to mock payments
BROWSER_USE_API_KEY=                   # enables portal booking automation

# ── APP CONFIG ────────────────────────────────────────────
PORT=3001
NODE_ENV=development
DEMO_PAYMENT_AMOUNT=0.01              # override all payment amounts for demo
```

> **Minimum viable demo**: Only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `GEMINI_API_KEY` are required. Everything else is optional.

### Step 4: Start

```bash
npm run dev:all
```

This starts both the backend (port 3001) and frontend (port 5173) concurrently.

Open **http://localhost:5173**

---

## Demo Walkthrough

### 1. Report an issue (Tenant View)

- Go to **http://localhost:5173/tenant**
- Select a tenant (e.g., Bob Smith) and describe a problem in the chat:
  > "The kitchen faucet is dripping constantly and the floor is getting wet"
- The AI asks follow-up questions, then auto-creates a maintenance ticket

### 2. Watch autonomous processing (Dashboard)

- Go to **http://localhost:5173/dashboard**
- Click the new ticket to see it process in real-time:
  - **Classify**: Gemini identifies category (plumbing), urgency (high), cost estimate
  - **Policy**: Auto-approves if under spending threshold
  - **Memory**: Supermemory checks for past issues at this unit
  - **Vendor**: Best-match vendor selected by specialty + rating
  - **Email**: Dispatch email sent to vendor via AgentMail
- Each step appears in the Event Timeline as it happens

### 3. Schedule via vendor portal

- On a ticket in `VENDOR_CONTACTED` status, click **Book via Portal**
- Browser Use opens a cloud browser, fills the vendor's booking form, and extracts a confirmation number
- The live browser session is visible as an embedded iframe in the dashboard

### 4. Pay vendor in USDC

- Once scheduled, click **Pay Vendor via Sponge**
- The backend calls Sponge to transfer USDC to the vendor's Solana wallet
- The on-chain transaction hash appears in the Sponge Payment Receipt with a link to Solscan

### 5. Predictive insights

- Go to the **Insights** tab in the dashboard
- AI analyzes all tickets + Supermemory history to detect patterns
  > "Unit 1A has had 3 plumbing issues in 6 months — recommend full pipe inspection"
- Click **Find Local Services** to search for vendors via Google grounding

### 6. Tenant tracking

- Back in Tenant View, the tenant sees:
  - Real-time progress bar (classified → vendor assigned → scheduled → paid)
  - Schedule details
  - On-chain payment receipt with Solscan link

---

## Three Views

| Role | URL | What they see |
|------|-----|---------------|
| Property Manager | `/dashboard` | All tickets, vendor management, predictive insights, memory chat |
| Tenant | `/tenant` | AI chat to report issues, track request status, payment receipts |
| Vendor | `/vendors` | Vendor list and assignment history |

## Key Features

- **Fully autonomous dispatch** — email in, repair scheduled, vendor paid, zero manual steps
- **On-chain payments** — vendors get paid USDC via Sponge, tenants see tx proof on Solscan
- **Contextual memory** — Supermemory learns from every repair, detects recurring issues, briefs vendors on past unit history
- **Browser automation** — Browser Use fills out vendor booking portals automatically via cloud browser
- **Predictive maintenance** — AI spots patterns across units and recommends preventive action
- **Service discovery** — finds and compares local vendors via Google Search grounding
- **Real-time dashboard** — WebSocket + Supabase Realtime push updates as tickets progress

## Project Structure

```
Leakly/
├── src/
│   ├── index.ts                 # Express server entry point
│   ├── db/index.ts              # Supabase client
│   ├── routes/
│   │   ├── orchestrator.ts      # Ticket processing + browser booking endpoints
│   │   ├── tickets.ts           # CRUD for tickets
│   │   ├── payments.ts          # Payment endpoints (Sponge + Stripe)
│   │   └── portal.ts            # Mock vendor booking portal
│   └── services/
│       ├── orchestrator.service.ts   # Main pipeline: classify → vendor → email → pay
│       ├── classification.service.ts # Gemini AI classification
│       ├── communication.service.ts  # AgentMail email dispatch
│       ├── memory.service.ts         # Supermemory context lookup
│       ├── sponge.service.ts         # USDC payments via Sponge MCP API
│       ├── browser.service.ts        # Browser Use cloud automation
│       ├── payment.service.ts        # Payment orchestration (Sponge/Stripe/mock)
│       ├── vendor.service.ts         # Vendor selection algorithm
│       └── policy.service.ts         # Spending policy evaluation
├── frontend/src/
│   ├── pages/
│   │   ├── Dashboard.tsx        # Property manager dashboard
│   │   ├── TenantChat.tsx       # Tenant chat interface
│   │   ├── TicketDetail.tsx     # Ticket detail with event timeline
│   │   └── Vendors.tsx          # Vendor management
│   └── lib/api.ts               # Backend API client
├── supabase-migration.sql       # Database schema + seed data
├── .env.example                 # Environment template
└── package.json
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `GEMINI_API_KEY` error on startup | Make sure the key is set in `.env` — this is the only key that crashes the app if missing |
| Tickets stuck at `NEW` | Check that `GEMINI_API_KEY` is valid; classification is the first pipeline step |
| No vendor emails sent | Set `AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX`; without these, emails are logged but not sent |
| Payment stuck at `sponge_pending` | Ensure `SPONGE_API_KEY` is set and the wallet has USDC; check server logs for transfer errors |
| Browser booking not working | Set `BROWSER_USE_API_KEY`; the "Book via Portal" button only appears when configured |
| Frontend won't load | Make sure you ran `cd frontend && npm install`; check that port 5173 is free |
| Supabase connection error | Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct; make sure you ran the migration SQL |
