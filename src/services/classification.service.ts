import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Emergency keywords that hard-override AI urgency
const EMERGENCY_KEYWORDS = [
  "gas leak", "fire", "flood", "no heat", "sewage",
  "electrical fire", "carbon monoxide", "broken pipe",
  "ceiling collapse", "smoke",
];

export interface ClassificationResult {
  category: string;
  urgency: string;
  urgencyScore: number;
  estimatedCostMin: number;
  estimatedCostMax: number;
  description: string;
  confidence: number;
  recommendedAction: string;
}

const classificationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    category: {
      type: SchemaType.STRING,
      enum: ["plumbing", "electrical", "hvac", "appliance", "structural", "pest", "general", "other"],
      description: "The maintenance category",
    },
    urgency: {
      type: SchemaType.STRING,
      enum: ["low", "medium", "high", "emergency"],
      description: "Urgency level",
    },
    urgencyScore: {
      type: SchemaType.NUMBER,
      description: "Urgency score from 0.0 to 1.0",
    },
    estimatedCostMin: {
      type: SchemaType.NUMBER,
      description: "Minimum estimated repair cost in USD",
    },
    estimatedCostMax: {
      type: SchemaType.NUMBER,
      description: "Maximum estimated repair cost in USD",
    },
    description: {
      type: SchemaType.STRING,
      description: "Brief summary of the issue",
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Classification confidence from 0.0 to 1.0",
    },
    recommendedAction: {
      type: SchemaType.STRING,
      description: "Recommended next step",
    },
  },
  required: [
    "category", "urgency", "urgencyScore",
    "estimatedCostMin", "estimatedCostMax",
    "description", "confidence", "recommendedAction",
  ],
};

const SYSTEM_PROMPT = `You are a property maintenance AI classifier. Given a tenant's maintenance request, classify it accurately.

Guidelines:
- category: Choose the most specific category that fits the issue
- urgency: "emergency" for safety hazards or habitability threats, "high" for significant problems affecting daily life, "medium" for inconveniences, "low" for cosmetic or minor issues
- urgencyScore: 0.0 (not urgent at all) to 1.0 (immediate danger)
- estimatedCostMin/Max: Realistic USD range for the repair. Consider parts + labor.
- description: One-sentence summary of the issue
- confidence: How confident you are in your classification (0.0 to 1.0)
- recommendedAction: What should happen next (e.g., "Dispatch plumber immediately", "Schedule routine inspection")

Be practical and accurate. Tenant safety is the top priority.`;

export const classificationService = {
  async classify(subject: string, body: string): Promise<ClassificationResult> {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: classificationSchema,
        temperature: 0.2,
      },
    });

    const prompt = `Classify this maintenance request:\n\nSubject: ${subject}\n\nBody: ${body}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const classification: ClassificationResult = JSON.parse(text);

    // Emergency keyword hard-override
    const combinedText = `${subject} ${body}`.toLowerCase();
    const hasEmergencyKeyword = EMERGENCY_KEYWORDS.some((kw) => combinedText.includes(kw));

    if (hasEmergencyKeyword && classification.urgency !== "emergency") {
      classification.urgency = "emergency";
      classification.urgencyScore = Math.max(classification.urgencyScore, 0.95);
      classification.recommendedAction = `EMERGENCY OVERRIDE: ${classification.recommendedAction}`;
    }

    // Clamp scores
    classification.urgencyScore = Math.max(0, Math.min(1, classification.urgencyScore));
    classification.confidence = Math.max(0, Math.min(1, classification.confidence));

    return classification;
  },
};
