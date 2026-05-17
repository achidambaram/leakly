import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { TicketInbox } from './pages/TicketInbox';
import { TicketDetail } from './pages/TicketDetail';
import { VendorList } from './pages/VendorList';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-blue-600">Leakly</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  Autonomous Dispatcher
                </span>
              </div>
              <nav className="flex gap-1">
                <NavLink
                  to="/"
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
                  to="/vendors"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  Vendors
                </NavLink>
              </nav>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Routes>
            <Route path="/" element={<TicketInbox />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/vendors" element={<VendorList />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
