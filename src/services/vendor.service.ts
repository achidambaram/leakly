import { supabase } from "../db/index.js";

interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  specialties: string[];
  rating: number;
  status: string;
  serviceArea: string;
  availabilityScore: number;
  hourlyRate: number | null;
  pastJobCount: number;
  pastPerformanceScore: number;
  responseTimeAvgHours: number;
}

export interface VendorSelectionResult {
  vendor: Vendor;
  score: number;
  reason: string;
}

function toCamel(row: any): Vendor {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    specialties: row.specialties,
    rating: row.rating,
    status: row.status,
    serviceArea: row.service_area,
    availabilityScore: row.availability_score,
    hourlyRate: row.hourly_rate,
    pastJobCount: row.past_job_count,
    pastPerformanceScore: row.past_performance_score,
    responseTimeAvgHours: row.response_time_avg_hours,
  };
}

function weightedScore(vendor: Vendor): number {
  return (
    vendor.rating * 0.4 +
    vendor.pastPerformanceScore * 5 * 0.3 +
    vendor.availabilityScore * 5 * 0.2 +
    0.5 * 0.1
  );
}

export const vendorService = {
  async selectVendor(
    category: string,
    excludeIds: string[] = []
  ): Promise<VendorSelectionResult | null> {
    const { data, error } = await supabase
      .from("vendors")
      .select("*")
      .eq("status", "active");

    if (error || !data) return null;

    const allVendors = data.map(toCamel);
    const candidates = allVendors.filter(
      (v) => v.specialties.includes(category) && !excludeIds.includes(v.id)
    );

    if (candidates.length === 0) return null;

    const ranked = candidates
      .map((v) => ({ vendor: v, score: weightedScore(v) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    return {
      vendor: best.vendor,
      score: best.score,
      reason: `Top ranked for ${category} (score: ${best.score.toFixed(2)}, rating: ${best.vendor.rating}, jobs: ${best.vendor.pastJobCount})`,
    };
  },

  async getById(id: string): Promise<Vendor | null> {
    const { data, error } = await supabase.from("vendors").select("*").eq("id", id).single();
    if (error || !data) return null;
    return toCamel(data);
  },

  async listAll(): Promise<Vendor[]> {
    const { data, error } = await supabase.from("vendors").select("*");
    if (error || !data) return [];
    return data.map(toCamel);
  },
};
