import { Router } from "express";
import { SeedController } from "./seed.controller";
import { authMiddleware } from "../../middleware/authMiddleware";

const router = Router();

router.post(
  "/generate-demo-store",
  authMiddleware("super_admin"),
  SeedController.generateDemoStore,
);
router.post(
  "/generate-all-demo-stores",
  authMiddleware("super_admin"),
  SeedController.generateAllDemoStores,
);
router.delete(
  "/delete-demo-store",
  authMiddleware("super_admin"),
  SeedController.deleteDemoStore,
);
router.delete(
  "/delete-all-demo-stores",
  authMiddleware("super_admin"),
  SeedController.deleteAllDemoStores,
);
router.post(
  "/demo",
  authMiddleware("tenant_admin"),
  SeedController.seedDemoData,
);
router.delete(
  "/reset",
  authMiddleware("tenant_admin"),
  SeedController.clearSeedData,
);

export const SeedRoutes = router;
