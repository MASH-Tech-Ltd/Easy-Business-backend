import { Router } from "express";
import { UserController } from "./user.controller";
import { UserValidation } from "./user.validation";
import { authMiddleware } from '../../middleware/authMiddleware';
import { upload } from '../../middleware/multer.middleware';
import { validateRequest } from '../../middleware/validateRequest';

const router = Router();

// Merchant updating their own profile
router.put(
  "/me",
  authMiddleware("tenant_admin", "super_admin"),
  upload.single("avatar"),
  validateRequest(UserValidation.updateProfileValidation),
  UserController.updateProfile
);

// Super admin routes
router.get("/", authMiddleware("super_admin"), UserController.getAllUsers);
router.get("/:id", authMiddleware("super_admin"), UserController.getUserById);
router.put("/:id", authMiddleware("super_admin"), validateRequest(UserValidation.updateUserValidation), UserController.updateUser);
router.delete("/:id", authMiddleware("super_admin"), UserController.deleteUser);

export const UserRoutes = router;
