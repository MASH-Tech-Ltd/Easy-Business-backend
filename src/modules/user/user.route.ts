import { Router } from "express";
import { UserController } from "./user.controller";
import { authMiddleware } from '../../middleware/authMiddleware';
import { upload } from '../../middleware/multer.middleware';

const router = Router();

// Merchant updating their own profile
router.put(
  "/me",
  authMiddleware("tenant_admin"),
  upload.single("avatar"),
  UserController.updateProfile
);

// Super admin routes
router.get("/", authMiddleware("super_admin"), UserController.getAllUsers);
router.get("/:id", authMiddleware("super_admin"), UserController.getUserById);
router.put("/:id", authMiddleware("super_admin"), UserController.updateUser);
router.delete("/:id", authMiddleware("super_admin"), UserController.deleteUser);

export const UserRoutes = router;
