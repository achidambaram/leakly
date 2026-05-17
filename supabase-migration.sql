-- Run this in Supabase Dashboard > SQL Editor
-- Creates all tables for the Leakly application

CREATE TABLE IF NOT EXISTS property_units (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  unit_number TEXT NOT NULL,
  property_manager_id TEXT NOT NULL,
  tenant_email TEXT,
  tenant_name TEXT,
  notes JSONB DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  specialties JSONB NOT NULL,
  rating REAL NOT NULL DEFAULT 3.0,
  status TEXT NOT NULL DEFAULT 'active',
  service_area TEXT NOT NULL,
  availability_score REAL NOT NULL DEFAULT 0.8,
  hourly_rate REAL,
  past_job_count INTEGER NOT NULL DEFAULT 0,
  past_performance_score REAL NOT NULL DEFAULT 0.5,
  response_time_avg_hours REAL NOT NULL DEFAULT 12,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  external_email_id TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tenant_email TEXT NOT NULL,
  tenant_name TEXT,
  property_unit_id TEXT NOT NULL REFERENCES property_units(id),
  raw_subject TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  classification JSONB DEFAULT 'null',
  assigned_vendor_id TEXT REFERENCES vendors(id),
  vendor_contacted_at TEXT,
  vendor_responded_at TEXT,
  scheduled_date TEXT,
  scheduled_time_slot TEXT,
  payment_status TEXT NOT NULL DEFAULT 'none',
  payment_intent_id TEXT,
  payment_amount REAL,
  payment_approved_by TEXT,
  policy_decision TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  notes JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS payment_records (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  stripe_payment_intent_id TEXT,
  stripe_invoice_id TEXT,
  payment_link_url TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'created',
  approved_by TEXT,
  approved_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_logs (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_id TEXT,
  previous_state TEXT,
  new_state TEXT,
  data JSONB DEFAULT '{}',
  description TEXT NOT NULL
);

-- Enable Realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE event_logs;

-- Seed data: property units
INSERT INTO property_units (id, address, unit_number, property_manager_id, tenant_email, tenant_name, notes, created_at)
VALUES
  ('unit_1a', '123 Oak Street', '101', 'pm_001', 'alice@example.com', 'Alice Johnson', '[]', '2024-01-01T00:00:00.000Z'),
  ('unit_2b', '456 Elm Avenue', '202', 'pm_001', 'bob@example.com', 'Bob Smith', '[]', '2024-01-01T00:00:00.000Z'),
  ('unit_3c', '789 Pine Road', '305', 'pm_001', 'carol@example.com', 'Carol Davis', '[]', '2024-01-01T00:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

-- Seed data: vendors
INSERT INTO vendors (id, name, email, phone, specialties, rating, status, service_area, availability_score, hourly_rate, past_job_count, past_performance_score, response_time_avg_hours, created_at, updated_at)
VALUES
  ('vendor_plumb_01', 'Bay Area Plumbing Co.', 'dispatch@bayareaplumbing.example.com', '555-0101', '["plumbing"]', 4.5, 'active', 'Bay Area', 0.9, 85, 34, 0.92, 4, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
  ('vendor_elec_01', 'Spark Electric Services', 'jobs@sparkelectric.example.com', '555-0102', '["electrical"]', 4.2, 'active', 'Bay Area', 0.85, 95, 21, 0.88, 6, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
  ('vendor_hvac_01', 'CoolBreeze HVAC', 'service@coolbreeze.example.com', '555-0103', '["hvac"]', 4.7, 'active', 'Bay Area', 0.75, 110, 15, 0.95, 8, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
  ('vendor_pest_01', 'BugBusters Pest Control', 'bugbusters@pestcontrol.example.com', '555-0104', '["pest"]', 4.0, 'active', 'Bay Area', 0.95, 75, 28, 0.82, 12, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'),
  ('vendor_general_01', 'HandyPro Maintenance', 'bookings@handypro.example.com', '555-0105', '["general","appliance","structural"]', 3.8, 'active', 'Bay Area', 0.7, 65, 42, 0.78, 10, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')
ON CONFLICT (id) DO NOTHING;
