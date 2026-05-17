# Leakly — Autonomous Maintenance Dispatcher

Leakly is an AI-powered property maintenance dispatch system. Tenants send an email describing a maintenance issue, and the system autonomously classifies it, selects a vendor, contacts them, schedules the repair, handles payment approval, and keeps everyone notified.

## Architecture

```
Tenant Email (Gmail)
      |
      v
  AgentMail Inbox ──> Express API ──> Orchestrator
                                         |
                    ┌────────────────────┼────────────────────┐
                    v                    v                    v
             Gemini AI            Supermemory           Vendor Service
           (classify)         (context lookup)        (rank & select)
                                                          |
                                                          v
                                                    AgentMail (send)
                                                          |
                                              ┌───────────┴───────────┐
                                              v                       v
                                       Vendor Email              Tenant Email
                                       (dispatch)              (confirmation)
                                              |
                                              v
                                     Vendor Reply ──> Gemini AI (parse intent)
                                                          |
                                         ┌────────────────┼────────────┐
                                         v                v            v
                                     Confirmed         Declined     Unclear
                                    (schedule)       (retry next)  (escalate)
                                         |
                                         v
                                   Payment Flow (Stripe)
                                         |
                                         v
                                      COMPLETED
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | TypeScript, Express, Node.js |
| Frontend | React 19, Vite, TailwindCSS |
| Database | Supabase (PostgreSQL) |
| AI | Google Gemini 2.5 Flash |
| Email | AgentMail |
| Memory | Supermemory |
| Payments | Stripe |
| Realtime | WebSocket |

## Setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project
- API keys for: [AgentMail](https://agentmail.to), [Google Gemini](https://ai.google.dev), [Supermemory](https://supermemory.ai), [Stripe](https://stripe.com)

### 1. Install dependencies

```bash
npm install
cd frontend && npm install && cd ..
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key

# AgentMail
AGENTMAIL_API_KEY=your_agentmail_api_key
AGENTMAIL_INBOX=your_inbox@agentmail.to

# Google Gemini
GEMINI_API_KEY=your_gemini_api_key

# Supermemory
SUPERMEMORY_API_KEY=your_supermemory_api_key

# Stripe (optional — falls back to mock mode)
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# Server
PORT=3001
NODE_ENV=development
```

### 3. Set up the database

1. Go to your Supabase Dashboard > **SQL Editor**
2. Paste the contents of `supabase-migration.sql` and run it
3. This creates all tables and seeds sample property units + vendors

### 4. Register your email as a tenant

Update one of the seeded property units to use your email:

```sql
UPDATE property_units
SET tenant_email = 'your-email@gmail.com', tenant_name = 'Your Name'
WHERE id = 'unit_1a';
```

### 5. Start the app

```bash
# Terminal 1 — Backend
npm run dev

# Terminal 2 — Frontend
npm run dev:frontend
```

Or run both at once:

```bash
npm run dev:all
```

- Backend: http://localhost:3001
- Frontend: http://localhost:5173

## Testing the Full Pipeline

### Step 1: Send a maintenance request

Send an email from your personal email (the one you registered in step 4) to your AgentMail inbox address (the `AGENTMAIL_INBOX` value in `.env`).

Write it like a real tenant — for example:

> **Subject:** Kitchen faucet leaking badly
>
> Hi, the kitchen faucet in my unit has been dripping non-stop for two days.
> Water is pooling under the sink. Can someone come fix it?

### Step 2: Pull the email into Leakly

Open the dashboard at **http://localhost:5173** and click the **"Check Inbox"** button. This polls the AgentMail inbox for new messages.

Your ticket will appear within a few seconds. The system automatically:
- Classifies the issue with Gemini AI (category, urgency, cost estimate)
- Looks up tenant/unit history in Supermemory
- Selects the best-matching vendor
- Sends a dispatch email to the vendor
- Notifies you (the tenant) that a vendor has been assigned

### Step 3: Reply as the vendor

Click into the ticket on the dashboard. You'll see an orange **"Reply as Vendor"** section.

Type a reply as if you're the vendor:
- `"Sure, I can come tomorrow at 10am"` — confirms and schedules
- `"Sorry, fully booked this week"` — declines, system tries the next vendor
- `"Can we do Thursday at 3pm instead?"` — counter-offer, auto-accepted

The AI parses the vendor's intent and moves the ticket forward.

### Step 4: Approve payment (as property manager)

If the estimated cost exceeds $200, the ticket requires manager approval. A yellow **"Approve Payment"** button appears on the ticket detail page. Click it.

### Step 5: Complete payment

After approval, a **"Simulate Payment"** button appears. Click it to simulate the Stripe payment and mark the ticket as `COMPLETED`.

### Step 6: Check the event timeline

Scroll down on the ticket detail page to see the full audit trail — every step from email received to ticket completed, with timestamps and actors.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/tickets` | List all tickets |
| GET | `/api/tickets/:id` | Get ticket details |
| POST | `/api/tickets` | Create ticket manually |
| GET | `/api/vendors` | List all vendors |
| GET | `/api/events` | List event logs |
| POST | `/api/classify` | Classify a maintenance request |
| POST | `/api/orchestrator/process/:id` | Trigger orchestration for a ticket |
| POST | `/api/webhooks/agentmail/inbound` | AgentMail inbound webhook |
| POST | `/api/webhooks/poll-inbox` | Poll AgentMail for new emails |
| POST | `/api/webhooks/vendor-reply` | Submit a vendor reply from the dashboard |
| POST | `/api/payments/tickets/:id/approve-payment` | Approve a pending payment |
| POST | `/api/payments/:id/simulate-pay` | Simulate payment completion |

## Ticket Lifecycle

```
NEW → CLASSIFIED → PRIORITIZED → VENDOR_SELECTED → VENDOR_CONTACTED
                                                          |
                    ┌─────────────────────────────────────┤
                    v                                     v
              (vendor confirms)                    (vendor declines)
                    |                                     |
                    v                              retry next vendor
               SCHEDULED                          or REQUIRES_HUMAN
                    |
          ┌─────────┴──────────┐
          v                    v
   (cost <= $200)        (cost > $200)
    auto-approved        PENDING_APPROVAL
          |                    |
          v               (manager approves)
   PAYMENT_PENDING             |
          |                    v
          v             PAYMENT_PENDING
   (payment received)         |
          |              (payment received)
          v                    v
      COMPLETED            COMPLETED
```
