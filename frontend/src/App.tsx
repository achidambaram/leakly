import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import { TicketInbox } from './pages/TicketInbox';
import { TicketDetail } from './pages/TicketDetail';
import { VendorList } from './pages/VendorList';
import { TenantStatus } from './pages/TenantStatus';
import { TenantLanding } from './pages/TenantLanding';
import { RoleSelect } from './pages/RoleSelect';
import { MemoryChat } from './pages/MemoryChat';
import { Insights } from './pages/Insights';

function AdminLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <Link to="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-600">Leakly</span>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                Property Manager
              </span>
            </Link>
            <nav className="flex gap-1">
              <NavLink
                to="/dashboard"
                end
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                Tickets
              </NavLink>
              <NavLink
                to="/dashboard/insights"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                Insights
              </NavLink>
              <NavLink
                to="/dashboard/memory"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                Memory
              </NavLink>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Routes>
          <Route path="/" element={<TicketInbox />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/memory" element={<MemoryChat />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Role selector */}
        <Route path="/" element={<RoleSelect />} />

        {/* Property Manager */}
        <Route path="/dashboard/*" element={<AdminLayout />} />

        {/* Tenant */}
        <Route path="/tenant" element={<TenantLanding />} />
        <Route path="/track/:id" element={<TenantStatus />} />

        {/* Vendor */}
        <Route path="/vendors" element={
          <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-14">
                  <Link to="/" className="flex items-center gap-2">
                    <span className="text-xl font-bold text-blue-600">Leakly</span>
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                      Vendor Portal
                    </span>
                  </Link>
                </div>
              </div>
            </header>
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <VendorList />
            </main>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
