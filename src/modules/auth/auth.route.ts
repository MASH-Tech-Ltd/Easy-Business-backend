import { Router } from 'express';
import { AuthController } from './auth.controller';
import { validate, registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.validation';
import { globalRateLimiter, customRateLimit } from '../../middleware/rateLimiter';

const router = Router();

// Apply rate limiting to all auth routes to prevent brute force
router.use(globalRateLimiter);

// SECURITY FIX: Added Zod validation middleware to both endpoints.
// Validates email format, password length (min 8), name length.
// Replaces req.body with sanitized data — extra fields are stripped.

// Specific strict rate limits
const loginLimit = customRateLimit(15 * 60 * 1000, 5, 'Too many login attempts, try again after 15 minutes.');
const forgotLimit = customRateLimit(60 * 60 * 1000, 5, 'Too many reset requests, try again after 1 hour.');
const registerLimit = customRateLimit(60 * 60 * 1000, 5, 'Too many registration attempts, try again after 1 hour.');

import { authMiddleware } from '../../middleware/authMiddleware';

router.post('/register', registerLimit, validate(registerSchema), AuthController.register);
router.post('/login', loginLimit, validate(loginSchema), AuthController.login);
router.post('/logout', AuthController.logout);
router.post('/forgot-password', forgotLimit, validate(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), AuthController.resetPassword);
router.post('/refresh-token', AuthController.refreshToken);
router.post('/change-password-request', authMiddleware('super_admin', 'tenant_admin'), AuthController.requestChangePassword);
router.post('/change-password-verify', authMiddleware('super_admin', 'tenant_admin'), AuthController.verifyChangePassword);

export const AuthRoutes = router;
