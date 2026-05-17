import { Router } from "express";
import { vendorService } from "../services/vendor.service.js";

export const vendorRouter = Router();

// GET /api/vendors
vendorRouter.get("/", async (_req, res) => {
  try {
    const allVendors = await vendorService.listAll();
    res.json(allVendors);
  } catch (err) {
    res.status(500).json({ error: "Failed to list vendors" });
  }
});

// GET /api/vendors/:id
vendorRouter.get("/:id", async (req, res) => {
  try {
    const vendor = await vendorService.getById(req.params.id);
    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ error: "Failed to get vendor" });
  }
});
