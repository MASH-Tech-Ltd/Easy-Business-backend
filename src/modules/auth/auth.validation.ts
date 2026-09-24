import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ── Schemas ───────────────────────────────────────────────────────────────────

const passwordValidation = z
  .string({ message: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  );

export const registerSchema = z.object({
  name: z
    .string({ message: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  email: z
    .string({ message: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: passwordValidation,
  phone: z
    .string()
    .trim()
    .max(29, 'Phone number too long')
    .optional(),
});

export const loginSchema = z.object({
  email: z
    .string({ message: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: passwordValidation,
});

export const forgotPasswordSchema = z.object({
  email: z
    .string({ message: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
});

export const resetPasswordSchema = z.object({
  resetToken: z
    .string({ message: 'Reset token is required' })
    .min(1, 'Reset token is required'),
  otp: z
    .string({ message: 'OTP is required' })
    .min(1, 'OTP is required'),
  password: passwordValidation,
});

// ── Middleware factories ──────────────────────────────────────────────────────

type ZodSchema = z.ZodTypeAny;

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }
    // Replace req.body with the parsed (sanitized) data
    req.body = result.data;
    next();
  };
};
