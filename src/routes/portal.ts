import { Router } from "express";

export const portalRouter = Router();

/**
 * GET /portal
 * Mock vendor booking portal — a simple HTML form that simulates
 * a real vendor's online scheduling system.
 */
portalRouter.get("/", (_req, res) => {
  res.send(PORTAL_HTML);
});

/**
 * POST /portal/book
 * Handles the booking form submission. Returns a confirmation.
 */
portalRouter.post("/book", (req, res) => {
  const { issueType, address, description, preferredDate, preferredTime, contactEmail } = req.body;

  const confirmationNumber = `BK-${Date.now().toString(36).toUpperCase()}`;

  res.json({
    success: true,
    confirmation: {
      confirmationNumber,
      issueType,
      address,
      scheduledDate: preferredDate,
      scheduledTime: preferredTime,
      contactEmail,
      message: `Booking confirmed! A technician will arrive on ${preferredDate} during the ${preferredTime} window.`,
    },
  });
});

export const PORTAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bay Area Plumbing Co. — Online Booking</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; min-height: 100vh; display: flex; justify-content: center; padding: 40px 20px; }
    .container { background: white; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 520px; width: 100%; padding: 36px; }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
    .logo-icon { width: 40px; height: 40px; background: #2563eb; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; }
    .logo h1 { font-size: 20px; color: #1e293b; }
    .logo p { font-size: 12px; color: #64748b; }
    h2 { font-size: 16px; color: #334155; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 4px; }
    input, select, textarea { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; color: #1e293b; transition: border-color 0.2s; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    textarea { resize: vertical; min-height: 80px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    button { width: 100%; padding: 12px; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; margin-top: 8px; }
    button:hover { background: #1d4ed8; }
    .confirmation { display: none; text-align: center; padding: 24px; }
    .confirmation.show { display: block; }
    .confirmation h3 { color: #16a34a; font-size: 18px; margin-bottom: 8px; }
    .confirmation .number { font-size: 28px; font-weight: 700; color: #1e293b; margin: 12px 0; font-family: monospace; }
    .confirmation p { color: #64748b; font-size: 14px; line-height: 1.5; }
    .form-section { transition: opacity 0.3s; }
    .form-section.hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <div class="logo-icon">P</div>
      <div>
        <h1>Bay Area Plumbing Co.</h1>
        <p>Licensed & Insured — Serving the Bay Area since 2015</p>
      </div>
    </div>

    <div class="form-section" id="formSection">
      <h2>Schedule a Service Visit</h2>
      <form id="bookingForm">
        <div class="field">
          <label for="issueType">Type of Issue</label>
          <select id="issueType" name="issueType" required>
            <option value="">Select an issue type...</option>
            <option value="leak">Leak / Drip</option>
            <option value="clog">Clogged Drain</option>
            <option value="toilet">Toilet Repair</option>
            <option value="water_heater">Water Heater</option>
            <option value="pipe">Pipe Repair / Replace</option>
            <option value="faucet">Faucet Install / Repair</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div class="field">
          <label for="address">Service Address</label>
          <input type="text" id="address" name="address" placeholder="123 Oak Street, Unit 101" required>
        </div>

        <div class="field">
          <label for="description">Describe the Issue</label>
          <textarea id="description" name="description" placeholder="Tell us what's going on..." required></textarea>
        </div>

        <div class="row">
          <div class="field">
            <label for="preferredDate">Preferred Date</label>
            <input type="date" id="preferredDate" name="preferredDate" required>
          </div>
          <div class="field">
            <label for="preferredTime">Preferred Time</label>
            <select id="preferredTime" name="preferredTime" required>
              <option value="">Select...</option>
              <option value="8AM-10AM">8:00 AM - 10:00 AM</option>
              <option value="10AM-12PM">10:00 AM - 12:00 PM</option>
              <option value="12PM-2PM">12:00 PM - 2:00 PM</option>
              <option value="2PM-4PM">2:00 PM - 4:00 PM</option>
              <option value="4PM-6PM">4:00 PM - 6:00 PM</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label for="contactEmail">Contact Email</label>
          <input type="email" id="contactEmail" name="contactEmail" placeholder="you@example.com" required>
        </div>

        <button type="submit">Book Service Visit</button>
      </form>
    </div>

    <div class="confirmation" id="confirmation">
      <h3>Booking Confirmed!</h3>
      <div class="number" id="confirmNumber"></div>
      <p id="confirmDetails"></p>
    </div>
  </div>

  <script>
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('preferredDate').value = tomorrow.toISOString().split('T')[0];

    document.getElementById('bookingForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = Object.fromEntries(new FormData(form));

      // Try server-side first, fall back to client-side confirmation
      let confirmationNumber, message;
      try {
        const res = await fetch('/portal/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        confirmationNumber = result.confirmation.confirmationNumber;
        message = result.confirmation.message;
      } catch {
        // Client-side fallback (for cloud browser that can't reach localhost)
        confirmationNumber = 'BK-' + Date.now().toString(36).toUpperCase();
        message = 'Booking confirmed! A technician will arrive on ' + data.preferredDate + ' during the ' + data.preferredTime + ' window.';
      }

      document.getElementById('formSection').classList.add('hidden');
      document.getElementById('confirmation').classList.add('show');
      document.getElementById('confirmNumber').textContent = confirmationNumber;
      document.getElementById('confirmDetails').textContent = message;
    });
  </script>
</body>
</html>`;
