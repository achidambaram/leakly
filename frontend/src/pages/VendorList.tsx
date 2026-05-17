import { useEffect, useState } from 'react';
import { fetchVendors } from '../lib/api';

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

export function VendorList() {
  const [vendors, setVendors] = useState<Vendor[]>([]);

  useEffect(() => {
    fetchVendors().then(setVendors);
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-900 mb-4">Vendors</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vendors.map((vendor) => (
          <div key={vendor.id} className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-medium text-gray-900">{vendor.name}</h3>
                <p className="text-xs text-gray-500">{vendor.email}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                vendor.status === 'active' ? 'bg-green-100 text-green-700' :
                vendor.status === 'inactive' ? 'bg-gray-100 text-gray-500' :
                'bg-red-100 text-red-700'
              }`}>
                {vendor.status}
              </span>
            </div>

            {/* Specialties */}
            <div className="flex flex-wrap gap-1 mb-3">
              {vendor.specialties.map((s) => (
                <span key={s} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">
                  {s}
                </span>
              ))}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Rating" value={`${vendor.rating.toFixed(1)} / 5`} />
              <Stat label="Jobs" value={String(vendor.pastJobCount)} />
              <Stat label="Avg Response" value={`${vendor.responseTimeAvgHours}h`} />
              <Stat label="Performance" value={`${(vendor.pastPerformanceScore * 100).toFixed(0)}%`} />
              <Stat label="Availability" value={`${(vendor.availabilityScore * 100).toFixed(0)}%`} />
              <Stat label="Rate" value={vendor.hourlyRate ? `$${vendor.hourlyRate}/hr` : 'N/A'} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-700 font-medium">{value}</span>
    </div>
  );
}
