import { Router } from 'express';
import { AuthController } from './auth.controller';
import { validate, registerSchema, loginSchema } from './auth.validation';

const router = Router();

// SECURITY FIX: Added Zod validation middleware to both endpoints.
// Validates email format, password length (min 8), name length.
// Replaces req.body with sanitized data — extra fields are stripped.
router.post('/register', validate(registerSchema), AuthController.register);
router.post('/login', validate(loginSchema), AuthController.login);

export const AuthRoutes = router;
