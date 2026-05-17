# Leakly — System Architecture Document

## Autonomous Maintenance Dispatcher (Property Ops Agent)

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Core Services Breakdown](#2-core-services-breakdown)
3. [Data Models](#3-data-models)
4. [State Machine](#4-state-machine)
5. [Tool Integrations](#5-tool-integrations)
6. [MVP Build Plan](#6-mvp-build-plan)
7. [Failure Modes & Edge Cases](#7-failure-modes--edge-cases)
8. [Assumptions & Adaptation Strategy](#8-assumptions--adaptation-strategy)
9. [Architectural Evaluation](#9-architectural-evaluation)
10. [Safety & Control Layer](#10-safety--control-layer)

---

## 1. System Architecture

### Text-Based Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React)                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Inbox/  │  │Ticket Detail │  │ Vendors  │  │ Policy Settings  │  │
│  │ Tickets  │  │    View      │  │  List    │  │                   │  │
│  └────┬─────┘  └──────┬───────┘  └────┬─────┘  └───────┬───────────┘  │
│       └───────────────┴──────────────┴────────────────┘               │
│                            │ REST + WebSocket                          │
└────────────────────────────┼───────────────────────────────────────────┘
                             │
┌────────────────────────────┼───────────────────────────────────────────┐
│                      API GATEWAY (Express)                             │
│              Routes / Auth / WebSocket Hub / Rate Limiting             │
└────────────────────────────┼───────────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼──────┐   ┌────────▼───────┐   ┌───────▼────────┐
│   TICKET     │   │  ORCHESTRATOR  │   │    VENDOR      │
│   SERVICE    │   │    SERVICE     │   │    SERVICE     │
│              │   │                │   │                │
│ - CRUD       │   │ - State mgmt   │   │ - Selection    │
│ - Lifecycle  │   │ - Tool calls   │   │ - Ranking      │
│ - Search     │   │ - Workflow     │   │ - Comms log    │
└───────┬──────┘   └───┬───┬───┬───┘   └───────┬────────┘
        │              │   │   │                │
        └──────┬───────┘   │   └────────┬───────┘
               │           │            │
    ┌──────────▼──┐   ┌────▼─────┐  ┌───▼──────────┐
    │   POLICY    │   │    AI    │  │COMMUNICATION │
    │   ENGINE    │   │  LAYER   │  │   SERVICE    │
    │             │   │          │  │              │
    │ - Rules     │   │ - Gemini │  │ - AgentMail  │
    │ - Thresholds│   │ - Classify│ │ - Templates  │
    │ - Emergency │   │ - Parse  │  │ - Parse      │
    └─────────────┘   └────┬─────┘  └──────┬───────┘
                           │               │
              ┌────────────┼───────────────┼──────────────┐
              │            │               │              │
     ┌────────▼───┐  ┌─────▼──────┐  ┌─────▼────┐  ┌─────▼─────┐
     │ SUPERMEMORY│  │ AGENTMAIL  │  │ BROWSER  │  │  STRIPE   │
     │            │  │            │  │   USE    │  │           │
     │ - History  │  │ - Inbound  │  │          │  │ - Intents │
     │ - Context  │  │ - Outbound │  │ - Portal │  │ - Links   │
     │ - Vectors  │  │ - Webhook  │  │ - Forms  │  │ - Invoice │
     └────────────┘  └────────────┘  └──────────┘  └───────────┘
              │            │               │              │
              └────────────┴───────────────┴──────────────┘
                                   │
                        ┌──────────▼──────────┐
                        │   EVENT LOG / DB    │
                        │   (PostgreSQL)      │
                        │                     │
                        │ - Tickets           │
                        │ - Events            │
                        │ - Vendors           │
                        │ - Payments          │
                        │ - Audit Trail       │
                        └─────────────────────┘
```

### Component Responsibilities

| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | React + Vite | Dashboard, ticket management, policy config |
| API Gateway | Express.js | Routing, WebSocket, auth |
| Orchestrator | Node.js | State machine execution, tool coordination |
| AI Layer | Google Gemini API | Classification, parsing, decision-making |
| Memory | Supermemory API | Context retrieval, history |
| Communication | AgentMail API | All email I/O |
| Browser Automation | Browser Use | Vendor portal scheduling |
| Payments | Stripe API | Payment links, invoices |
| Database | PostgreSQL (or SQLite for MVP) | Persistence, audit log |

---

## 2. Core Services Breakdown

### 2.1 Ticket Service

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | CRUD operations on maintenance tickets. Owns the ticket lifecycle record. |
| **Inputs** | Parsed email data from Communication Service, manual creation from dashboard |
| **Outputs** | Ticket objects, status change events |
| **Dependencies** | Database, Event Bus |

Key operations:
- `createTicket(parsedEmail)` → Ticket
- `updateStatus(ticketId, newStatus, metadata)` → Ticket
- `getTicket(ticketId)` → Ticket
- `listTickets(filters)` → Ticket[]
- `addEvent(ticketId, event)` → EventLog

### 2.2 Orchestrator Service

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Drives the ticket through the state machine. Calls AI, tools, and other services in sequence. Central brain. |
| **Inputs** | New ticket events, vendor response events, manual overrides |
| **Outputs** | State transitions, tool invocations, notifications |
| **Dependencies** | Ticket Service, AI Layer, Vendor Service, Communication Service, Policy Engine, Payment Service |

Key operations:
- `processNewTicket(ticket)` → void (kicks off full workflow)
- `handleVendorResponse(ticketId, emailPayload)` → void
- `handleManualOverride(ticketId, action, userId)` → void
- `retryStep(ticketId, step)` → void

Workflow execution model:
```
async processNewTicket(ticket):
  1. classify(ticket)           → AI Layer
  2. enrichContext(ticket)      → Supermemory
  3. applyPolicies(ticket)      → Policy Engine
  4. selectVendor(ticket)       → Vendor Service
  5. contactVendor(ticket)      → Communication Service
  6. awaitResponse()            → event-driven (async)
  7. confirmSchedule(ticket)    → Communication Service
  8. triggerPayment(ticket)     → Payment Service (if policy allows)
  9. markCompleted(ticket)      → Ticket Service
```

### 2.3 Vendor Service

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Manages vendor registry. Selects optimal vendor for a job. Tracks vendor communication state. |
| **Inputs** | Ticket category, location, urgency; vendor response emails |
| **Outputs** | Selected vendor, vendor contact details, availability status |
| **Dependencies** | Database, Supermemory (vendor history) |

Selection algorithm (MVP):
```
selectVendor(ticket):
  candidates = vendors.filter(v =>
    v.specialties.includes(ticket.category) &&
    v.status === 'active'
  )
  ranked = candidates.sort((a, b) =>
    weightedScore(b) - weightedScore(a)
  )
  return ranked[0]

weightedScore(vendor):
  return (vendor.rating * 0.4) +
         (vendor.pastPerformance * 0.3) +
         (vendor.availabilityScore * 0.2) +
         (vendor.proximityScore * 0.1)
```

### 2.4 Policy Engine

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Evaluates rules to determine auto-approval, escalation, and emergency behavior. |
| **Inputs** | Ticket classification, cost estimate, urgency score |
| **Outputs** | Policy decisions: auto-approve, require-approval, escalate, emergency-dispatch |
| **Dependencies** | Policy configuration (DB or config file) |

Rule evaluation:
```
evaluatePolicy(ticket, classification):
  if classification.urgency === 'emergency':
    return { action: 'emergency_dispatch', notify: 'property_manager' }

  if classification.estimated_cost <= policy.auto_approve_limit:
    return { action: 'auto_approve' }

  return { action: 'require_approval', approver: 'property_manager' }
```

Default policy configuration:
```json
{
  "auto_approve_limit": 200,
  "emergency_keywords": ["gas leak", "no heat", "flood", "fire", "electrical fire", "sewage"],
  "max_vendor_response_wait_hours": 24,
  "max_vendor_retries": 2,
  "require_approval_above": 200,
  "business_hours": { "start": "08:00", "end": "18:00", "timezone": "America/Los_Angeles" }
}
```

### 2.5 Communication Service

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | All email I/O via AgentMail. Parses inbound emails, sends outbound emails, logs all communication events. |
| **Inputs** | Inbound webhook payloads (AgentMail), outbound email requests from Orchestrator |
| **Outputs** | Parsed email data, send confirmations, event logs |
| **Dependencies** | AgentMail API, AI Layer (for email parsing) |

Key operations:
- `parseInboundEmail(webhook)` → ParsedEmail
- `sendVendorRequest(vendor, ticket)` → SendResult
- `sendTenantNotification(tenant, message)` → SendResult
- `sendApprovalRequest(manager, ticket)` → SendResult

### 2.6 Payment Service

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Stripe integration for generating payment links, creating invoices, tracking payment status. |
| **Inputs** | Ticket with cost estimate, vendor details, policy decision |
| **Outputs** | Payment link URL, invoice ID, payment status |
| **Dependencies** | Stripe API, Policy Engine (approval thresholds) |

Key operations:
- `createPaymentLink(ticket, vendor, amount)` → { url, paymentIntentId }
- `createInvoice(ticket, vendor, amount)` → { invoiceId, url }
- `checkPaymentStatus(paymentIntentId)` → PaymentStatus
- `handleWebhook(stripeEvent)` → void

---

## 3. Data Models

### 3.1 Ticket

```typescript
interface Ticket {
  id: string;                    // UUID
  externalEmailId: string;       // AgentMail message ID
  status: TicketStatus;          // State machine state
  createdAt: Date;
  updatedAt: Date;

  // Tenant info
  tenantEmail: string;
  tenantName: string | null;
  propertyUnitId: string;

  // Original request
  rawSubject: string;
  rawBody: string;

  // AI classification
  classification: {
    category: MaintenanceCategory; // 'plumbing' | 'electrical' | 'hvac' | 'appliance' | 'structural' | 'pest' | 'other'
    urgency: 'low' | 'medium' | 'high' | 'emergency';
    urgencyScore: number;          // 0.0 - 1.0
    estimatedCostMin: number;
    estimatedCostMax: number;
    description: string;           // AI-generated summary
    confidence: number;            // 0.0 - 1.0
    recommendedAction: string;
  } | null;

  // Vendor assignment
  assignedVendorId: string | null;
  vendorContactedAt: Date | null;
  vendorRespondedAt: Date | null;

  // Scheduling
  scheduledDate: Date | null;
  scheduledTimeSlot: string | null; // e.g., "2:00 PM - 5:00 PM"

  // Payment
  paymentStatus: 'none' | 'pending' | 'link_sent' | 'paid' | 'failed';
  paymentIntentId: string | null;
  paymentAmount: number | null;
  paymentApprovedBy: string | null;

  // Policy
  policyDecision: 'auto_approved' | 'pending_approval' | 'approved' | 'rejected' | null;

  // Metadata
  retryCount: number;
  failureReason: string | null;
  notes: string[];
}

type TicketStatus =
  | 'NEW'
  | 'CLASSIFIED'
  | 'PRIORITIZED'
  | 'VENDOR_SELECTED'
  | 'VENDOR_CONTACTED'
  | 'AWAITING_VENDOR_RESPONSE'
  | 'SCHEDULED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_COMPLETED'
  | 'COMPLETED'
  | 'FAILED'
  | 'REQUIRES_HUMAN_INTERVENTION'
  | 'CANCELLED';

type MaintenanceCategory =
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'appliance'
  | 'structural'
  | 'pest'
  | 'general'
  | 'other';
```

### 3.2 Vendor

```typescript
interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  specialties: MaintenanceCategory[];
  rating: number;                  // 1.0 - 5.0
  status: 'active' | 'inactive' | 'blacklisted';
  serviceArea: string;             // e.g., "Bay Area"
  availabilityScore: number;       // 0.0 - 1.0 (mocked for MVP)
  hourlyRate: number | null;
  pastJobCount: number;
  pastPerformanceScore: number;    // 0.0 - 1.0
  responseTimeAvgHours: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.3 Property Unit

```typescript
interface PropertyUnit {
  id: string;
  address: string;
  unitNumber: string;
  propertyManagerId: string;
  tenantEmail: string | null;
  tenantName: string | null;
  notes: string[];
  createdAt: Date;
}
```

### 3.4 Maintenance Request (Parsed Email)

```typescript
interface MaintenanceRequest {
  id: string;
  ticketId: string;
  sourceEmailId: string;
  senderEmail: string;
  senderName: string | null;
  subject: string;
  body: string;
  receivedAt: Date;
  parsedAt: Date;
  attachments: Array<{
    filename: string;
    contentType: string;
    url: string;
  }>;
}
```

### 3.5 Payment Record

```typescript
interface PaymentRecord {
  id: string;
  ticketId: string;
  vendorId: string;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  paymentLinkUrl: string | null;
  amount: number;
  currency: string;               // 'usd'
  status: 'created' | 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
  approvedBy: string | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.6 Event Log (Audit Trail)

```typescript
interface EventLog {
  id: string;
  ticketId: string;
  timestamp: Date;
  eventType: EventType;
  actor: 'system' | 'ai' | 'property_manager' | 'tenant' | 'vendor';
  actorId: string | null;
  previousState: TicketStatus | null;
  newState: TicketStatus | null;
  data: Record<string, any>;      // Event-specific payload
  description: string;            // Human-readable description
}

type EventType =
  | 'ticket_created'
  | 'email_received'
  | 'email_sent'
  | 'ai_classification'
  | 'memory_lookup'
  | 'vendor_selected'
  | 'vendor_contacted'
  | 'vendor_responded'
  | 'schedule_confirmed'
  | 'payment_created'
  | 'payment_approved'
  | 'payment_completed'
  | 'payment_failed'
  | 'status_changed'
  | 'manual_override'
  | 'error'
  | 'retry'
  | 'escalation';
```

### Entity Relationship Diagram

```
┌──────────────┐     1:N     ┌──────────────┐
│ PropertyUnit │─────────────│    Ticket     │
└──────────────┘             └──────┬───────┘
                                    │
                         ┌──────────┼──────────┐
                         │          │          │
                      1:1│       1:N│       0:1│
                         │          │          │
               ┌─────────▼──┐ ┌────▼─────┐ ┌──▼────────────┐
               │Maintenance │ │ EventLog │ │PaymentRecord  │
               │  Request   │ │          │ │               │
               └────────────┘ └──────────┘ └───────────────┘
                                                    │
                                                 N:1│
                                                    │
                                              ┌─────▼─────┐
                              Ticket.vendor──▶│   Vendor   │
                                              └───────────┘
```

---

## 4. State Machine

### 4.1 State Transition Table

| Current State | Event/Trigger | Next State | Guard Condition |
|---------------|---------------|------------|-----------------|
| — | `email_received` | `NEW` | Valid tenant email |
| `NEW` | `classification_complete` | `CLASSIFIED` | AI confidence > 0.5 |
| `NEW` | `classification_failed` | `REQUIRES_HUMAN_INTERVENTION` | AI confidence ≤ 0.5 or error |
| `CLASSIFIED` | `policy_evaluated` | `PRIORITIZED` | Policy engine returns decision |
| `PRIORITIZED` | `vendor_found` | `VENDOR_SELECTED` | At least 1 vendor available |
| `PRIORITIZED` | `no_vendor_available` | `REQUIRES_HUMAN_INTERVENTION` | No matching vendors |
| `VENDOR_SELECTED` | `email_sent_to_vendor` | `VENDOR_CONTACTED` | Email send success |
| `VENDOR_SELECTED` | `email_send_failed` | `FAILED` | Email send error after retries |
| `VENDOR_CONTACTED` | `vendor_response_received` | `SCHEDULED` | Vendor confirms availability |
| `VENDOR_CONTACTED` | `vendor_declined` | `VENDOR_SELECTED` | Re-select next vendor (retry < max) |
| `VENDOR_CONTACTED` | `vendor_timeout` | `VENDOR_SELECTED` | No response within timeout, retry |
| `VENDOR_CONTACTED` | `all_vendors_exhausted` | `REQUIRES_HUMAN_INTERVENTION` | No vendors left |
| `SCHEDULED` | `payment_required` | `PAYMENT_PENDING` | Cost > 0 and policy requires payment |
| `SCHEDULED` | `no_payment_needed` | `COMPLETED` | Cost = 0 or auto-approved |
| `PAYMENT_PENDING` | `payment_approved` | `PAYMENT_COMPLETED` | Manager approves or auto-approved |
| `PAYMENT_PENDING` | `payment_rejected` | `REQUIRES_HUMAN_INTERVENTION` | Manager rejects |
| `PAYMENT_PENDING` | `payment_failed` | `FAILED` | Stripe error after retries |
| `PAYMENT_COMPLETED` | `work_confirmed` | `COMPLETED` | Work verified |
| `REQUIRES_HUMAN_INTERVENTION` | `manual_override` | (any valid state) | Manager action |
| `FAILED` | `retry_initiated` | (previous state) | Manual retry |
| Any | `cancelled` | `CANCELLED` | Manager cancels |

### 4.2 State Diagram

```
                    ┌───────────┐
   email_received──▶│    NEW    │
                    └─────┬─────┘
                          │
              ┌───────────┴───────────┐
              │ classification        │ classification
              │ _complete             │ _failed
              ▼                       ▼
        ┌───────────┐    ┌─────────────────────────────┐
        │CLASSIFIED │    │ REQUIRES_HUMAN_INTERVENTION  │◄──┐
        └─────┬─────┘    └──────────────┬──────────────┘   │
              │                         │ manual_override   │
              │ policy_evaluated        │ (goes to any)     │
              ▼                         │                   │
        ┌────────────┐                  │                   │
        │PRIORITIZED │                  │                   │
        └─────┬──────┘                  │                   │
              │                         │                   │
    ┌─────────┴─────────┐              │                   │
    │ vendor_found       │ no_vendor   │                   │
    ▼                    └─────────────┼───────────────────┘
┌────────────────┐                     │
│VENDOR_SELECTED │◄────────────┐       │
└───────┬────────┘             │       │
        │                      │       │
        │ email_sent           │       │
        ▼                      │       │
┌────────────────────┐         │       │
│ VENDOR_CONTACTED   │─────────┘       │
└───────┬────────────┘ vendor_declined │
        │                  or timeout  │
        │ vendor_confirms              │
        ▼                              │
  ┌───────────┐                        │
  │ SCHEDULED │                        │
  └─────┬─────┘                        │
        │                              │
  ┌─────┴──────────┐                   │
  │ payment_needed  │ no_payment       │
  ▼                 ▼                  │
┌─────────────┐  ┌───────────┐         │
│PAYMENT_     │  │ COMPLETED │         │
│PENDING      │  └───────────┘         │
└──────┬──────┘       ▲                │
       │              │                │
  ┌────┴────┐         │                │
  │approved │rejected │                │
  ▼         └─────────┼────────────────┘
┌─────────────┐       │
│PAYMENT_     │───────┘
│COMPLETED    │ work_confirmed
└─────────────┘

  Any state ──cancelled──▶ CANCELLED
  Any state ──error──▶ FAILED ──retry──▶ (previous state)
```

### 4.3 Invalid Transitions (Explicitly Forbidden)

- `COMPLETED` → any state (except via manual override)
- `CANCELLED` → any state (except via manual override)
- `NEW` → `SCHEDULED` (cannot skip classification/vendor selection)
- `CLASSIFIED` → `VENDOR_CONTACTED` (must select vendor first)
- `PAYMENT_PENDING` → `COMPLETED` (must go through `PAYMENT_COMPLETED`)
- Any backward transition without explicit retry trigger

---

## 5. Tool Integrations

### 5.1 AgentMail

**Purpose:** All email communication — inbound tenant requests, outbound vendor contact, tenant notifications.

#### Ingestion (Inbound)

```typescript
// Webhook payload from AgentMail
interface AgentMailInboundWebhook {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;             // plain text
  htmlBody: string | null;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    url: string;
  }>;
  receivedAt: string;       // ISO 8601
  threadId: string | null;
}
```

Webhook endpoint: `POST /api/webhooks/agentmail/inbound`

Processing flow:
1. Receive webhook → validate signature
2. Determine email type (new request vs. vendor reply vs. unknown)
3. If new request → create ticket, trigger orchestrator
4. If vendor reply → match to ticket by threadId, trigger orchestrator
5. Log event to audit trail

#### Outbound Email

```typescript
interface AgentMailOutbound {
  to: string;
  subject: string;
  body: string;
  replyTo: string;
  threadId?: string;         // to maintain email threading
  metadata?: {
    ticketId: string;
    emailType: 'vendor_request' | 'tenant_notification' | 'approval_request';
  };
}
```

Templates:
- **Vendor Request:** "Maintenance request for {unit} — {category} issue. {description}. Available {timeSlots}?"
- **Tenant Confirmation:** "Your repair is scheduled for {date} at {time}. Technician: {vendorName}."
- **Tenant Update:** "Update on your maintenance request: {statusMessage}"
- **Approval Request:** "Approval needed: {category} repair at {unit}. Estimated cost: ${amount}."

#### Event Logging

Every email event (sent, received, bounced, opened) is logged to `EventLog` with:
- `ticketId`
- `eventType`: `email_received` | `email_sent`
- `data`: full email metadata (no body stored in event — reference by messageId)

#### Failure Handling

| Failure | Mitigation |
|---------|-----------|
| Webhook delivery failure | AgentMail retries 3x with exponential backoff |
| Send failure | Retry 2x, then mark ticket as `FAILED` |
| Unparseable email | Create ticket with `REQUIRES_HUMAN_INTERVENTION`, attach raw email |

### 5.2 Supermemory

**Purpose:** Contextual memory layer for tenant history, unit history, vendor performance, and property rules.

#### Stored Entities

| Entity | Key Fields | Use Case |
|--------|-----------|----------|
| Tenant History | tenantEmail, pastTickets[], issueFrequency | Personalization, pattern detection |
| Unit History | unitId, pastIssues[], lastRepairDate | Recurring issue detection |
| Vendor Performance | vendorId, avgResponseTime, completionRate, avgRating | Vendor selection ranking |
| Property Rules | propertyId, customPolicies, preferredVendors | Policy augmentation |

#### Retrieval Logic

```typescript
// Query patterns
async function getTicketContext(ticket: Ticket): Promise<MemoryContext> {
  const [tenantHistory, unitHistory, vendorPerf] = await Promise.all([
    supermemory.search({
      query: `tenant ${ticket.tenantEmail} maintenance history`,
      filter: { type: 'tenant_history' }
    }),
    supermemory.search({
      query: `unit ${ticket.propertyUnitId} past issues ${ticket.classification?.category}`,
      filter: { type: 'unit_history' }
    }),
    supermemory.search({
      query: `vendor performance ${ticket.classification?.category}`,
      filter: { type: 'vendor_performance' }
    })
  ]);

  return { tenantHistory, unitHistory, vendorPerf };
}
```

#### Write-back

After each ticket completion:
```typescript
async function updateMemory(ticket: Ticket): Promise<void> {
  await supermemory.add({
    content: `Ticket ${ticket.id}: ${ticket.classification?.category} issue at unit ${ticket.propertyUnitId}. Resolved by ${ticket.assignedVendorId}. Cost: $${ticket.paymentAmount}`,
    metadata: {
      type: 'unit_history',
      unitId: ticket.propertyUnitId,
      category: ticket.classification?.category,
      resolvedAt: new Date().toISOString()
    }
  });
}
```

#### Failure Handling

| Failure | Mitigation |
|---------|-----------|
| Supermemory API down | Continue without context — classification still works, just less personalized |
| Empty results | Proceed normally — first-time tenant/unit is a valid scenario |
| Slow response | 3s timeout, continue without context |

### 5.3 Browser Use

**Purpose:** Automate vendor scheduling portals when vendors don't respond to email or require portal-based booking.

#### When Invoked

Only when:
1. Vendor has a `schedulingPortalUrl` configured
2. Vendor has not responded to email within timeout
3. OR vendor explicitly says "book through our portal"

#### Automation Steps

```typescript
interface BrowserTask {
  vendorId: string;
  portalUrl: string;
  credentials: { username: string; password: string }; // stored encrypted
  actions: [
    { type: 'navigate', url: string },
    { type: 'login', username: string, password: string },
    { type: 'fillForm', fields: Record<string, string> },
    { type: 'selectTimeSlot', preferredSlots: string[] },
    { type: 'submit' },
    { type: 'extractConfirmation' }
  ];
}

// Output
interface BrowserResult {
  success: boolean;
  confirmationNumber: string | null;
  scheduledTime: string | null;
  screenshotUrl: string | null;    // for audit
  error: string | null;
}
```

#### Fallback Behavior

| Failure | Mitigation |
|---------|-----------|
| Login fails | Mark ticket `REQUIRES_HUMAN_INTERVENTION` with "Portal login failed" |
| Form structure changed | Fall back to email-only vendor contact |
| No available time slots | Notify orchestrator → try next vendor |
| Timeout (>60s) | Abort, fall back to email |

### 5.4 Stripe

**Purpose:** Payment link generation, invoice creation, payment tracking.

#### Payment Flow

```
Policy Decision
    │
    ├── auto_approve (cost ≤ threshold)
    │       │
    │       ▼
    │   createPaymentLink(amount, vendorEmail)
    │       │
    │       ▼
    │   Send link to vendor (or internal)
    │       │
    │       ▼
    │   Webhook: payment_intent.succeeded → PAYMENT_COMPLETED
    │
    └── require_approval (cost > threshold)
            │
            ▼
        Send approval request to property manager
            │
            ├── approved → createPaymentLink → (same as above)
            └── rejected → REQUIRES_HUMAN_INTERVENTION
```

#### API Contracts

```typescript
// Create payment link
async function createPaymentLink(params: {
  ticketId: string;
  vendorId: string;
  amount: number;          // in cents
  description: string;
}): Promise<{
  paymentLinkUrl: string;
  paymentIntentId: string;
}> {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: params.amount,
        product_data: { name: params.description }
      },
      quantity: 1
    }],
    mode: 'payment',
    metadata: {
      ticketId: params.ticketId,
      vendorId: params.vendorId
    },
    success_url: `${BASE_URL}/tickets/${params.ticketId}?payment=success`,
    cancel_url: `${BASE_URL}/tickets/${params.ticketId}?payment=cancelled`
  });

  return {
    paymentLinkUrl: session.url,
    paymentIntentId: session.payment_intent as string
  };
}
```

#### Webhook Handling

Endpoint: `POST /api/webhooks/stripe`

Events handled:
- `checkout.session.completed` → update PaymentRecord, transition ticket
- `payment_intent.payment_failed` → mark payment failed, notify manager
- `charge.refunded` → update PaymentRecord

#### Failure Handling

| Failure | Mitigation |
|---------|-----------|
| Stripe API error | Retry 2x with backoff, then `FAILED` |
| Payment declined | Notify property manager, ticket stays `PAYMENT_PENDING` |
| Webhook missed | Periodic polling (every 5 min) for pending payments |
| Refund needed | Manual trigger from dashboard → `stripe.refunds.create()` |

---

## 6. MVP Build Plan

### Phase 1: Core Ticket System (Foundation)

**Goal:** Basic ticket CRUD + database + API skeleton

**Tasks:**
- Initialize Node.js/Express project with TypeScript
- Set up PostgreSQL (or SQLite) with schema migrations
- Implement Ticket Service (create, read, update, list)
- Implement EventLog service
- Basic REST API endpoints (`/api/tickets`, `/api/events`)
- Seed data: sample properties, units, vendors

**Outputs:** Working API that can create and list tickets

**Dependencies:** None (starting point)

### Phase 2: AI Classification Layer

**Goal:** Incoming text → structured classification

**Tasks:**
- Integrate Google Gemini API
- Build classification prompt with JSON schema enforcement
- Implement classification service with:
  - Category detection
  - Urgency scoring
  - Cost estimation
  - Recommended action
- Validation layer for AI outputs (schema validation, confidence thresholds)
- Unit tests with sample maintenance requests

**Outputs:** `POST /api/classify` endpoint that returns structured classification

**Dependencies:** Phase 1 (needs ticket model)

### Phase 3: Vendor Orchestration

**Goal:** Vendor selection + communication flow

**Tasks:**
- Implement Vendor Service with selection algorithm
- Integrate AgentMail for:
  - Inbound webhook (tenant email intake)
  - Outbound emails (vendor requests, tenant notifications)
- Implement Communication Service with email templates
- Connect Orchestrator: NEW → CLASSIFIED → VENDOR_SELECTED → VENDOR_CONTACTED
- Implement vendor response parsing (AI-assisted)
- Add Supermemory integration for context enrichment

**Outputs:** End-to-end flow from email intake to vendor contact

**Dependencies:** Phase 1, Phase 2

### Phase 4: Scheduling Automation

**Goal:** Handle vendor responses and confirm appointments

**Tasks:**
- Implement vendor response handler (parse email replies)
- AI-based response interpretation (confirmed / declined / counter-offer)
- Implement state transitions: VENDOR_CONTACTED → SCHEDULED
- Tenant notification on scheduling confirmation
- Browser Use integration (optional — only if time permits)
- Implement timeout + retry logic for non-responsive vendors

**Outputs:** Full flow from vendor contact to confirmed schedule

**Dependencies:** Phase 3

### Phase 5: Payments Integration

**Goal:** Stripe payment flow triggered by policy

**Tasks:**
- Implement Policy Engine with configurable rules
- Integrate Stripe:
  - Payment link generation
  - Webhook handling
  - Payment status tracking
- Implement approval flow (email to property manager)
- Payment record tracking in database
- State transitions: SCHEDULED → PAYMENT_PENDING → PAYMENT_COMPLETED → COMPLETED

**Outputs:** Payment links generated, tracked, and ticket auto-completes on payment

**Dependencies:** Phase 4

### Phase 6: Dashboard + Observability

**Goal:** React frontend for monitoring and control

**Tasks:**
- Initialize React + Vite project
- Implement pages:
  - Ticket Inbox (list with status badges, real-time updates via WebSocket)
  - Ticket Detail (timeline, classification, vendor activity, payment status, actions)
  - Vendor List (specialties, ratings, status)
  - Policy Settings (edit thresholds, emergency rules)
- WebSocket integration for live updates
- Manual override controls (approve, reject, reassign, cancel)
- Basic auth (hardcoded property manager login for MVP)

**Outputs:** Fully functional dashboard showing real-time ticket lifecycle

**Dependencies:** Phases 1-5 (backend must be functional)

### Phase Dependency Graph

```
Phase 1 (Tickets)
    │
    ├──▶ Phase 2 (AI)
    │        │
    │        ▼
    │    Phase 3 (Vendors + Comms)
    │        │
    │        ▼
    │    Phase 4 (Scheduling)
    │        │
    │        ▼
    │    Phase 5 (Payments)
    │
    └──▶ Phase 6 (Dashboard) ◄── Phases 1-5
         (can start UI skeleton early,
          wire up as backends complete)
```

---

## 7. Failure Modes & Edge Cases

### 7.1 AI Misclassification

| Scenario | Impact | Mitigation |
|----------|--------|-----------|
| Wrong category (e.g., plumbing → electrical) | Wrong vendor dispatched | Confidence threshold (< 0.5 → human review). Vendor can decline and re-trigger classification. |
| Wrong urgency (emergency missed) | Delayed response to dangerous situation | Emergency keyword list as hard override (bypasses AI score). If keywords match → always emergency. |
| Hallucinated cost estimate | Overpay or fail to approve | Cost estimate is advisory only. Policy engine uses ranges, not exact values. Manager sees estimate on dashboard. |

### 7.2 Vendor Non-Response

| Scenario | Impact | Mitigation |
|----------|--------|-----------|
| Vendor never replies | Ticket stuck in VENDOR_CONTACTED | Timeout (24h default, configurable). Auto-select next vendor. Max 2 retries before `REQUIRES_HUMAN_INTERVENTION`. |
| Vendor replies with ambiguous text | AI can't parse intent | AI confidence threshold on response parsing. Low confidence → flag for human review. |
| All vendors decline | No one to dispatch | Escalate to property manager with full context. Ticket → `REQUIRES_HUMAN_INTERVENTION`. |

### 7.3 Email Parsing Failure

| Scenario | Impact | Mitigation |
|----------|--------|-----------|
| Email is not a maintenance request | False ticket created | AI classification includes `intent` field. If intent ≠ `maintenance_request` → auto-close or flag. |
| Email has no text (image only) | Can't classify | Create ticket as `REQUIRES_HUMAN_INTERVENTION` with attachments preserved. |
| Duplicate email (tenant sends twice) | Duplicate tickets | Dedup by sender email + subject + 1-hour window. Link duplicates to same ticket. |
| Spam / irrelevant email | Noise | AI intent classification filters. Confidence < 0.3 → discard with log. |

### 7.4 Scheduling Conflicts

| Scenario | Impact | Mitigation |
|----------|--------|-----------|
| Vendor confirms but tenant unavailable | Wasted appointment | MVP: assume tenant is available (stated hours in request). Future: confirmation email to tenant. |
| Double-booking a vendor | Overlapping jobs | MVP: not tracked (vendor manages own calendar). Future: track vendor schedule internally. |
| Browser automation fails on portal | Can't book | Fall back to email-based scheduling. Log failure for debugging. |

### 7.5 Payment Failures

| Scenario | Impact | Mitigation |
|----------|--------|-----------|
| Payment link expires | Vendor unpaid | Monitor expiry, regenerate link, notify manager. |
| Card declined | Payment stuck | Notify manager, keep ticket in `PAYMENT_PENDING`. Allow manual resolution. |
| Stripe webhook missed | Status out of sync | Periodic polling job (every 5 min) checks pending payment intents. |
| Overpayment / dispute | Financial issue | Out of scope for MVP. Log and flag for manual review. |

### 7.6 Partial Completion States

| Scenario | Impact | Mitigation |
|----------|--------|-----------|
| Orchestrator crashes mid-workflow | Ticket stuck in intermediate state | Each state transition is persisted atomically. On restart, orchestrator picks up tickets in non-terminal states and resumes. |
| Vendor completes work but payment fails | Work done, no payment recorded | Decouple work completion from payment. Mark work done, handle payment separately. |
| System reboots during email send | Uncertain if email was sent | Idempotent email sending (check if email with same threadId already sent before resending). |

---

## 8. Assumptions & Adaptation Strategy

### 8.1 System Assumptions

| Assumption | Rationale | Risk if Wrong |
|-----------|-----------|--------------|
| < 1000 properties | Hackathon MVP scale | Single DB instance sufficient, no sharding needed |
| < 100 concurrent tickets | Low volume | No queue system needed, synchronous orchestration OK |
| < 10 vendors per category | Small vendor pool | Simple ranking algorithm sufficient |
| Single property manager | MVP simplification | No multi-tenancy, RBAC, or org hierarchy |
| English-only emails | MVP constraint | AI prompts English-only, no i18n |

### 8.2 Tool Assumptions

| Tool | Assumption | If Unavailable |
|------|-----------|----------------|
| AgentMail | Reliable webhook delivery, < 5s latency | Fall back to direct IMAP/SMTP polling |
| Supermemory | Available with < 3s response time | Continue without context — system still functional |
| Browser Use | Reliable for simple form fills | Remove browser automation, use email-only flow |
| Stripe | Standard API availability | Mock payment flow, generate fake links |
| Gemini API | Available, < 10s response time | Cache common classifications, manual fallback |

### 8.3 Data Assumptions

| Assumption | Detail |
|-----------|--------|
| Tenant emails are semi-structured | Natural language, may include unit number in address |
| Vendor responses are simple | "Yes, available at X" or "No, can't do it" |
| Unit mapping exists | Tenant email can be mapped to a unit (pre-configured) |
| Cost estimates are approximate | AI provides range, not exact quote |

### 8.4 Replaceable Components

| Component | MVP | Production Replacement |
|-----------|-----|----------------------|
| Database | SQLite | PostgreSQL + Redis cache |
| AI Model | Gemini | Any LLM with JSON mode (GPT-4, Claude) |
| Email | AgentMail | SendGrid + custom inbound parsing |
| Memory | Supermemory | Pinecone + custom embedding pipeline |
| Browser | Browser Use | Playwright with custom scripts |
| Queue | None (sync) | BullMQ / RabbitMQ |
| Auth | Hardcoded | Auth0 / Clerk |

### 8.5 Graceful Degradation

```
If AgentMail fails:
  → Queue outbound emails for retry
  → Surface "communication delayed" on dashboard
  → Ticket stays in current state (no transition)

If Gemini API fails:
  → Use keyword-based classification fallback
  → Lower confidence score → more tickets go to human review
  → System remains functional, just less intelligent

If Stripe fails:
  → Skip payment step
  → Mark ticket as "payment deferred"
  → Alert property manager

If Supermemory fails:
  → Continue without historical context
  → Classification still works (just less informed)
  → No user-visible impact
```

### 8.6 MVP → Production Evolution Path

| Area | MVP | Production |
|------|-----|-----------|
| Orchestration | Synchronous, in-process | Event-driven with message queue |
| Database | Single instance | Read replicas, connection pooling |
| Auth | Hardcoded login | Multi-tenant SSO |
| Monitoring | Console logs | Structured logging, APM, alerting |
| Testing | Manual + seed data | Integration test suite, load tests |
| Deployment | Local / single server | Containerized, auto-scaling |
| Email | Single inbox | Per-property email addresses |
| AI | Single model | Model ensemble, fine-tuned classifier |

---

## 9. Architectural Evaluation

### 9.1 Why This Architecture

**Orchestrator pattern chosen over:**

| Alternative | Why Not |
|-------------|---------|
| Pure event-driven (choreography) | Too hard to debug in hackathon. No central place to see workflow state. |
| Monolithic script | Can't handle async vendor responses. No failure recovery. |
| Microservices | Overkill for MVP. Deployment complexity not worth it. |
| LLM agent loop (ReAct) | Unpredictable execution. Can't guarantee state machine integrity. |

**Why this hybrid approach works:**
- **Deterministic state machine** ensures every ticket follows a predictable path
- **AI is advisory, not autonomous** — AI classifies and recommends, but the orchestrator decides
- **Tools are modular** — each tool has a clear contract, can be mocked or replaced
- **Event log is first-class** — every action is auditable, enabling debugging and demos

### 9.2 What Breaks First in Real-World Usage

1. **Email parsing reliability** — Real tenant emails are messy. Typos, multiple issues in one email, images without text, reply chains. The AI parser will need continuous prompt tuning.

2. **Vendor response diversity** — Vendors reply in unpredictable ways. "Let me check and get back to you" is neither a yes nor a no. Edge cases multiply fast.

3. **State consistency** — If the orchestrator crashes between "email sent" and "state updated," the system can get confused. Need idempotent operations and crash recovery.

4. **Timeout tuning** — 24h vendor timeout might be too long for emergencies, too short for weekends. Needs per-category, per-urgency tuning.

### 9.3 Biggest Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| AI misclassifies emergency as low-priority | Medium | Critical (safety) | Emergency keyword hard-override, never fully trust AI for safety-critical decisions |
| Vendor gets spammed by retries | Medium | High (relationship damage) | Strict retry limits, dedup, human gate after 2 failures |
| Payment sent to wrong vendor | Low | High (financial) | Vendor ID verified at every step, payment requires ticket-vendor match |
| Email loops (auto-reply triggers auto-reply) | Medium | Medium (noise) | Loop detection: if same sender/thread > 3 emails in 1 hour, stop and flag |
| Data loss on crash | Low | High | WAL-mode SQLite / PostgreSQL transactions, no in-memory-only state |

### 9.4 Scaling Limitations

| Scale | What Breaks | Fix |
|-------|------------|-----|
| 10x (10K properties) | SQLite locks, synchronous orchestration bottleneck | PostgreSQL, async job queue (BullMQ) |
| 100x (100K properties) | Single-server limits, AI API rate limits | Horizontal scaling, AI model caching/batching, read replicas |
| 1000x (1M properties) | Everything | Full microservices, dedicated ML pipeline, regional deployment |

### 9.5 Human-in-the-Loop Boundaries

**Humans MUST intervene when:**
- AI classification confidence < 0.5
- Estimated cost > auto-approve threshold
- All vendors declined or timed out
- Emergency detected (human notified even if auto-dispatched)
- Payment fails
- Tenant disputes classification or scheduling
- Duplicate/conflicting tickets detected

**Override mechanisms:**
- Dashboard: reassign vendor, change classification, approve/reject payment, cancel ticket
- Email: property manager can reply to approval email with "approved" / "rejected"
- API: `POST /api/tickets/:id/override` with action payload

**Safety constraints:**
- No payment > $1000 without explicit human approval
- Emergency tickets always notify property manager (even if auto-dispatched)
- Vendor blacklisting requires human action
- System cannot delete tickets — only cancel (audit trail preserved)

---

## 10. Safety & Control Layer

### 10.1 Approval Thresholds

```yaml
payment:
  auto_approve_max: 200          # USD, auto-generate payment link
  require_approval_max: 1000     # USD, send approval request to manager
  block_above: 1000              # USD, require manual handling entirely

vendor_dispatch:
  auto_dispatch_urgency: ['medium', 'high', 'emergency']
  require_approval_urgency: ['low']  # Low urgency → manager decides if worth dispatching

emergency:
  auto_dispatch: true             # Always dispatch immediately
  notify_manager: true            # Always notify, even if auto-dispatched
  bypass_approval: true           # Skip payment approval for emergencies under $500
```

### 10.2 Emergency Escalation Rules

```typescript
const EMERGENCY_RULES = {
  keywords: ['gas leak', 'fire', 'flood', 'no heat', 'sewage', 'electrical fire', 'carbon monoxide', 'broken pipe', 'ceiling collapse'],
  behavior: {
    skipVendorSelection: false,   // Still pick best vendor
    skipApproval: true,           // Under emergency threshold
    notifyManager: true,          // Always
    maxResponseWait: '2h',        // Shorter timeout
    retryImmediately: true,       // Don't wait 24h
    fallbackAction: 'call_manager' // If no vendor responds
  }
};
```

### 10.3 Audit Logging Requirements

Every system action produces an `EventLog` entry. Required fields:
- **Who:** actor (system, AI, manager, tenant, vendor)
- **What:** eventType + description
- **When:** timestamp (UTC)
- **Context:** ticketId, previous state, new state
- **Data:** full payload of the action

Retention: All events retained indefinitely (MVP). No deletion allowed.

Query patterns:
- "Show me everything that happened on ticket X" → filter by ticketId
- "Show me all AI classifications in the last 24h" → filter by eventType + time
- "Show me all payment approvals" → filter by eventType

### 10.4 Rollback Behavior

| Scenario | Rollback Action |
|----------|----------------|
| Wrong vendor selected | Cancel current vendor communication, re-select. Old vendor gets "disregard" email. |
| Wrong classification | Re-classify, update ticket. If vendor already contacted, assess if still correct. |
| Payment sent in error | Stripe refund via dashboard. Manual process for MVP. |
| Ticket created from spam | Cancel ticket. No vendor contacted (spam caught before dispatch ideally). |

### 10.5 Idempotency Guarantees

| Operation | Idempotency Key | Behavior on Duplicate |
|-----------|----------------|----------------------|
| Create ticket from email | `sourceEmailId` | Return existing ticket |
| Send vendor email | `ticketId + vendorId + attempt` | Skip if already sent |
| Create payment link | `ticketId + vendorId` | Return existing link |
| Process webhook | `webhookEventId` | Skip if already processed |
| State transition | `ticketId + fromState + toState + trigger` | Skip if already transitioned |

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| **Language** | TypeScript (full stack) |
| **Frontend** | React 18 + Vite + TailwindCSS |
| **Backend** | Node.js + Express |
| **Database** | SQLite (MVP) → PostgreSQL (prod) |
| **ORM** | Drizzle ORM |
| **AI** | Google Gemini API |
| **Email** | AgentMail |
| **Memory** | Supermemory |
| **Browser** | Browser Use |
| **Payments** | Stripe |
| **WebSocket** | ws (or Socket.IO) |
| **Validation** | Zod |
| **Testing** | Vitest |
