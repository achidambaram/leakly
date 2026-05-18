import { useNavigate } from 'react-router-dom';

const ROLES = [
  {
    id: 'property_manager',
    title: 'Property Manager',
    description: 'Manage tickets, approve payments, oversee vendors',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    path: '/dashboard',
    color: 'blue',
  },
  {
    id: 'tenant',
    title: 'Tenant',
    description: 'Track your maintenance request status and payments',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1',
    path: '/tenant',
    color: 'green',
  },
  {
    id: 'vendor',
    title: 'Vendor',
    description: 'View assigned jobs and respond to service requests',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    path: '/vendors',
    color: 'orange',
  },
];

const colorMap: Record<string, { bg: string; border: string; text: string; iconBg: string; hover: string }> = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   iconBg: 'bg-blue-100',   hover: 'hover:border-blue-400 hover:shadow-blue-100' },
  green:  { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  iconBg: 'bg-green-100',  hover: 'hover:border-green-400 hover:shadow-green-100' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', iconBg: 'bg-orange-100', hover: 'hover:border-orange-400 hover:shadow-orange-100' },
};

export function RoleSelect() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-blue-600 mb-2">Leakly</h1>
          <p className="text-sm text-gray-500">Autonomous Maintenance Dispatcher</p>
          <p className="text-xs text-gray-400 mt-1">Select your role to continue</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ROLES.map((role) => {
            const c = colorMap[role.color];
            return (
              <button
                key={role.id}
                onClick={() => navigate(role.path)}
                className={`${c.bg} border ${c.border} rounded-xl p-6 text-left transition-all ${c.hover} hover:shadow-md cursor-pointer group`}
              >
                <div className={`w-12 h-12 ${c.iconBg} rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <svg className={`w-6 h-6 ${c.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={role.icon} />
                  </svg>
                </div>
                <h2 className={`text-lg font-semibold ${c.text} mb-1`}>{role.title}</h2>
                <p className="text-sm text-gray-500">{role.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
