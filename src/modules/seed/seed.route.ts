import { Router } from "express";
import { SeedController } from "./seed.controller";
import { authMiddleware } from "../../middleware/authMiddleware";

const router = Router();

// POST /api/seed/demo  — seed categories + products for the logged-in merchant
router.post("/demo", authMiddleware("tenant_admin"), SeedController.seedDemoData);

// DELETE /api/seed/reset  — delete ALL categories + products for the logged-in merchant
router.delete("/reset", authMiddleware("tenant_admin"), SeedController.clearSeedData);

export const SeedRoutes = router;
