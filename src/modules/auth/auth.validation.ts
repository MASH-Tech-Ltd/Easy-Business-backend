import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ── Schemas ───────────────────────────────────────────────────────────────────

const passwordValidation = z
  .string({ message: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[$@#%^&*?\-+=\!])/,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  );

export const registerSchema = z.object({
  name: z
    .string({ message: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  storeName: z
    .string({ message: 'Store name is required' })
    .trim()
    .min(2, 'Store name must be at least 2 characters')
    .max(100, 'Store name must be at most 100 characters'),
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
  referralCode: z
    .string()
    .trim()
    .max(50, 'Referral code too long')
    .optional(),
});

export const loginSchema = z.object({
  email: z
    .string({ message: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: passwordValidation,
  code: z.string().optional(),
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

import { SecurityLog } from '../system/security.model';
import { getClientIp } from '../../utils/ipHelper';

// ── Middleware factories ──────────────────────────────────────────────────────

type ZodSchema = z.ZodTypeAny;

export const validateRegister = (req: Request, res: Response, next: NextFunction) => {
  const body = req.body || {};
  const requestedRole = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';

  // CRITICAL SECURITY FIX: Block any attempt to request super_admin, admin, or any privileged role
  if (
    requestedRole === 'super_admin' ||
    requestedRole === 'admin' ||
    requestedRole === 'system_admin' ||
    requestedRole.includes('super') ||
    requestedRole.includes('admin') ||
    body.isAdmin ||
    body.isSuperAdmin
  ) {
    const ip = getClientIp(req);
    SecurityLog.create({
      incidentType: 'ADMIN_REGISTRATION_PROBE',
      endpoint: req.originalUrl,
      ipAddress: ip,
      reason: `Blocked unauthorized attempt to request/create administrative role: "${body.role}"`,
      requestedFrom: 'Public Registration Endpoint',
      userAgent: (req.headers['user-agent'] as string) || 'Unknown',
    }).catch((err) => console.error('Failed to log admin registration probe:', err));

    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Registration of administrative accounts is strictly prohibited.',
    });
  }

  // Strip any role or tenantId from the payload before schema validation
  delete body.role;
  delete body.tenantId;

  const result = registerSchema.safeParse(body);
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

  req.body = result.data;
  next();
};

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
