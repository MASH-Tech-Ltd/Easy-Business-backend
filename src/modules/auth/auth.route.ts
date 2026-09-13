import { Router } from 'express';
import { AuthController } from './auth.controller';
import { validate, registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.validation';

const router = Router();

// SECURITY FIX: Added Zod validation middleware to both endpoints.
// Validates email format, password length (min 8), name length.
// Replaces req.body with sanitized data — extra fields are stripped.
router.post('/register', validate(registerSchema), AuthController.register);
router.post('/login', validate(loginSchema), AuthController.login);
router.post('/forgot-password', validate(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), AuthController.resetPassword);
router.post('/refresh-token', AuthController.refreshToken);

export const AuthRoutes = router;
