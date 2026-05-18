/**
 * Browser Use Service — Automates vendor booking portals via Browser Use Cloud + Puppeteer.
 * Provisions a cloud browser, loads the vendor portal, fills the form, and extracts confirmation.
 */

import puppeteer from "puppeteer-core";
import { PORTAL_HTML } from "../routes/portal.js";

const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY || "";
const BROWSER_USE_API = "https://api.browser-use.com/api/v3";

interface BookingParams {
  issueType: string;
  address: string;
  description: string;
  preferredDate: string; // YYYY-MM-DD
  preferredTime: string; // e.g. "10AM-12PM"
  contactEmail: string;
}

interface BookingResult {
  success: boolean;
  confirmationNumber: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  error: string | null;
  liveUrl: string | null;
}

async function createCloudBrowser(): Promise<{
  browserId: string;
  wsUrl: string;
  liveUrl: string;
}> {
  const res = await fetch(`${BROWSER_USE_API}/browsers`, {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Browser Use API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const browserId = data.id || data.browserId;
  const cdpUrl = data.cdpUrl || data.cdp_url;
  const liveUrl = data.liveUrl || data.live_url || "";

  // Convert CDP HTTP URL to WebSocket URL
  const versionRes = await fetch(`${cdpUrl}/json/version`);
  const versionData = await versionRes.json();
  const wsUrl = versionData.webSocketDebuggerUrl;

  return { browserId, wsUrl, liveUrl };
}

async function stopCloudBrowser(browserId: string): Promise<void> {
  await fetch(`${BROWSER_USE_API}/browsers/${browserId}`, {
    method: "PATCH",
    headers: {
      "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "stop" }),
  }).catch(() => {});
}

export interface ServiceSearchResult {
  services: {
    name: string;
    rating: string;
    reviews: string;
    description: string;
    url: string;
  }[];
  liveUrl: string | null;
  searchQuery: string;
}

export const browserService = {
  isAvailable: !!BROWSER_USE_API_KEY,

  /**
   * Search Google for local services related to a maintenance issue.
   * Uses a cloud browser to search and extract results.
   */
  async searchLocalServices(params: {
    category: string;
    description: string;
    location?: string;
    onLiveUrl?: (url: string) => void;
  }): Promise<ServiceSearchResult> {
    const location = params.location || "San Francisco Bay Area";
    const searchQuery = `best ${params.category} services near ${location} ${params.description}`;
    let browserId: string | null = null;
    let liveUrl: string | null = null;

    try {
      const cloud = await createCloudBrowser();
      browserId = cloud.browserId;
      liveUrl = cloud.liveUrl;
      if (params.onLiveUrl && liveUrl) params.onLiveUrl(liveUrl);

      const browser = await puppeteer.connect({
        browserWSEndpoint: cloud.wsUrl,
        defaultViewport: { width: 1280, height: 900 },
      });

      const page = await browser.newPage();

      // Search Google
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await sleep(2000);

      // Extract search results
      const services = await page.evaluate(() => {
        const results: { name: string; rating: string; reviews: string; description: string; url: string }[] = [];

        // Try local pack results — extract the link from the parent anchor
        document.querySelectorAll('.VkpGBb, [jscontroller] .rllt__details, .uMdZh').forEach((el) => {
          const name = el.querySelector('.OSrXXb, .dbg0pd, [role="heading"], .fontHeadlineSmall')?.textContent?.trim() || "";
          const rating = el.querySelector('.MW4etd, .yi40Hd')?.textContent?.trim() || "";
          const reviews = el.querySelector('.UY7F9, .RDApEe, .hqzQac')?.textContent?.trim() || "";
          const desc = el.querySelector('.rllt__wrapped, .lrzwJe')?.textContent?.trim() || "";
          // Walk up to find an anchor tag with href
          let url = "";
          let parent: Element | null = el;
          while (parent && !url) {
            if (parent.tagName === "A" && (parent as HTMLAnchorElement).href) {
              url = (parent as HTMLAnchorElement).href;
            }
            parent = parent.parentElement;
          }
          if (name) results.push({ name, rating, reviews, description: desc, url });
        });

        // Organic results
        document.querySelectorAll('#search .g, #rso .g').forEach((el) => {
          const name = el.querySelector('h3')?.textContent?.trim() || "";
          const anchor = el.querySelector('a[href^="http"]') as HTMLAnchorElement | null;
          const url = anchor?.href || "";
          const desc = el.querySelector('.VwiC3b, [data-sncf], .IsZvec')?.textContent?.trim() || "";
          if (name && url && !results.some(r => r.name === name)) {
            results.push({ name, rating: "", reviews: "", description: desc, url });
          }
        });

        return results.slice(0, 8);
      });

      browser.disconnect();
      if (browserId) await stopCloudBrowser(browserId);

      return { services, liveUrl, searchQuery };
    } catch (err) {
      console.error("[Browser] Service search failed:", err);
      if (browserId) await stopCloudBrowser(browserId).catch(() => {});
      return { services: [], liveUrl, searchQuery };
    }
  },

  /**
   * Book a vendor appointment through their portal using Browser Use.
   * Loads the portal HTML directly into the cloud browser (no localhost access needed).
   */
  async bookViaPortal(params: BookingParams & { onLiveUrl?: (url: string) => void }): Promise<BookingResult> {
    let browserId: string | null = null;
    let liveUrl: string | null = null;

    try {
      console.log(`[Browser] Provisioning cloud browser...`);
      const cloud = await createCloudBrowser();
      browserId = cloud.browserId;
      liveUrl = cloud.liveUrl;
      console.log(`[Browser] Browser ready. Live view: ${liveUrl}`);
      if (params.onLiveUrl && liveUrl) params.onLiveUrl(liveUrl);

      // Connect Puppeteer to the cloud browser
      const browser = await puppeteer.connect({
        browserWSEndpoint: cloud.wsUrl,
        defaultViewport: { width: 1280, height: 900 },
      });

      const page = await browser.newPage();

      // Load the portal HTML directly into the browser
      console.log(`[Browser] Loading vendor booking portal...`);
      await page.setContent(PORTAL_HTML, { waitUntil: "networkidle0" });
      await page.waitForSelector("#bookingForm", { timeout: 10000 });
      await sleep(500);

      // Fill out the form with realistic typing delays
      console.log(`[Browser] Filling out booking form...`);

      // Select issue type
      await page.select("#issueType", params.issueType);
      await sleep(400);

      // Type address
      await page.click("#address");
      await page.type("#address", params.address, { delay: 60 });
      await sleep(300);

      // Type description
      await page.click("#description");
      await page.type("#description", params.description, { delay: 40 });
      await sleep(300);

      // Set date
      await page.$eval(
        "#preferredDate",
        (el: any, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        },
        params.preferredDate
      );
      await sleep(300);

      // Select time
      await page.select("#preferredTime", params.preferredTime);
      await sleep(300);

      // Type email
      await page.click("#contactEmail");
      await page.type("#contactEmail", params.contactEmail, { delay: 60 });
      await sleep(600);

      // Submit the form
      console.log(`[Browser] Submitting form...`);
      await page.click('button[type="submit"]');

      // Wait for confirmation to appear
      await page.waitForSelector("#confirmNumber", { visible: true, timeout: 10000 });
      await sleep(500);

      const confirmationNumber = await page.$eval(
        "#confirmNumber",
        (el: any) => el.textContent.trim()
      );

      console.log(`[Browser] Booking confirmed: ${confirmationNumber}`);

      browser.disconnect();
      if (browserId) await stopCloudBrowser(browserId);

      return {
        success: true,
        confirmationNumber,
        scheduledDate: params.preferredDate,
        scheduledTime: params.preferredTime,
        error: null,
        liveUrl,
      };
    } catch (err) {
      console.error(`[Browser] Booking failed:`, err);
      if (browserId) await stopCloudBrowser(browserId);
      return {
        success: false,
        confirmationNumber: null,
        scheduledDate: null,
        scheduledTime: null,
        error: (err as Error).message,
        liveUrl,
      };
    }
  },
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
