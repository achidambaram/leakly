/**
 * Response Parser Service — AI-powered interpretation of vendor email replies
 * Uses Gemini to determine: confirmed, declined, counter-offer, or unclear
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export type VendorIntent = "confirmed" | "declined" | "counter_offer" | "unclear";

export interface ParsedVendorResponse {
  intent: VendorIntent;
  confidence: number;
  scheduledDate: string | null;    // ISO date if confirmed/counter-offer
  scheduledTime: string | null;    // e.g., "2:00 PM - 4:00 PM"
  reason: string | null;          // why declined or details of counter-offer
  summary: string;                // brief interpretation
}

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    intent: {
      type: SchemaType.STRING,
      enum: ["confirmed", "declined", "counter_offer", "unclear"],
      description: "The vendor's intent",
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Confidence in interpretation 0.0-1.0",
    },
    scheduledDate: {
      type: SchemaType.STRING,
      description: "Proposed or confirmed date in YYYY-MM-DD format, or empty string if none",
    },
    scheduledTime: {
      type: SchemaType.STRING,
      description: "Proposed or confirmed time slot, or empty string if none",
    },
    reason: {
      type: SchemaType.STRING,
      description: "Reason for declining or details of counter-offer, or empty string",
    },
    summary: {
      type: SchemaType.STRING,
      description: "One-sentence summary of the vendor's response",
    },
  },
  required: ["intent", "confidence", "scheduledDate", "scheduledTime", "reason", "summary"],
};

const SYSTEM_PROMPT = `You are an AI assistant parsing vendor email replies to maintenance dispatch requests.

The vendor was asked if they're available to handle a maintenance job. Classify their response:

- "confirmed": Vendor agrees and provides a date/time (or says they can come today/tomorrow/ASAP)
- "declined": Vendor explicitly says no, too busy, can't do it, not available
- "counter_offer": Vendor proposes a different time than requested, or has conditions
- "unclear": Response doesn't clearly indicate availability (e.g., "let me check", questions, off-topic)

For dates:
- "today" = current date
- "tomorrow" = next day
- "Monday" / "next week" = interpret relative to today (${new Date().toISOString().split("T")[0]})
- If no specific date mentioned but they confirm availability, use empty string

For time slots, normalize to readable format like "9:00 AM - 11:00 AM" or "afternoon" or "2:00 PM".

Be practical. A vendor saying "Sure, I can swing by tomorrow morning" is a confirmation.`;

export interface ParsedTenantAvailability {
  hasAvailability: boolean;
  preferredDates: string[];    // ISO dates
  preferredTime: string | null; // e.g., "10:00 AM - 12:00 PM"
  summary: string;
}

const tenantAvailabilitySchema = {
  type: SchemaType.OBJECT,
  properties: {
    hasAvailability: {
      type: SchemaType.BOOLEAN,
      description: "Whether the tenant provided usable date/time availability",
    },
    preferredDate: {
      type: SchemaType.STRING,
      description: "The best/first preferred date in YYYY-MM-DD format, or empty string if none",
    },
    preferredTime: {
      type: SchemaType.STRING,
      description: "Preferred time slot normalized to readable format like '10:00 AM - 12:00 PM' or 'morning' or 'afternoon', or empty string if none",
    },
    summary: {
      type: SchemaType.STRING,
      description: "One-sentence summary of tenant's availability",
    },
  },
  required: ["hasAvailability", "preferredDate", "preferredTime", "summary"],
};

const TENANT_AVAILABILITY_PROMPT = `You are an AI assistant parsing tenant email replies about their availability for a maintenance appointment.

The tenant was asked when they're available for a repair visit. Extract their preferred date and time.

For dates:
- "today" = current date
- "tomorrow" = next day
- "Tuesday" / "next week" = interpret relative to today (${new Date().toISOString().split("T")[0]})
- If they give multiple dates, pick the earliest one
- If no specific date but they say something like "anytime this week", pick the next business day

For times:
- "morning" = "9:00 AM - 12:00 PM"
- "afternoon" = "12:00 PM - 5:00 PM"
- "after work" or "evening" = "5:00 PM - 7:00 PM"
- Normalize specific times to readable format

Set hasAvailability to false if the reply is off-topic, a question, or doesn't indicate any time preference.`;

export const responseParserService = {
  async parseTenantAvailability(emailBody: string, emailSubject?: string): Promise<ParsedTenantAvailability> {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: TENANT_AVAILABILITY_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: tenantAvailabilitySchema,
        temperature: 0.1,
      },
    });

    const prompt = emailSubject
      ? `Parse this tenant's availability reply:\n\nSubject: ${emailSubject}\n\nBody: ${emailBody}`
      : `Parse this tenant's availability reply:\n\n${emailBody}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    return {
      hasAvailability: parsed.hasAvailability,
      preferredDates: parsed.preferredDate ? [parsed.preferredDate] : [],
      preferredTime: parsed.preferredTime || null,
      summary: parsed.summary,
    };
  },

  async parseVendorResponse(emailBody: string, emailSubject?: string): Promise<ParsedVendorResponse> {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.1,
      },
    });

    const prompt = emailSubject
      ? `Parse this vendor reply:\n\nSubject: ${emailSubject}\n\nBody: ${emailBody}`
      : `Parse this vendor reply:\n\n${emailBody}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed: ParsedVendorResponse = JSON.parse(text);

    // Normalize empty strings to null
    parsed.scheduledDate = parsed.scheduledDate || null;
    parsed.scheduledTime = parsed.scheduledTime || null;
    parsed.reason = parsed.reason || null;

    // Clamp confidence
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

    return parsed;
  },
};
