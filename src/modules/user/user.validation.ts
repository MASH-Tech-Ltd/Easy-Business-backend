import { z } from 'zod';

const bdPhoneRegex = /^(?:\+?88|88)?01[3-9]\d{8}$/;

export const updateProfileValidation = z.object({
  body: z.object({
    name: z.string({ message: 'Name must be a string' }).min(1, 'Name cannot be empty').optional(),
    email: z.string().email('Invalid email address').optional(),
    phone: z.string()
      .refine((val) => {
        if (!val || !val.trim()) return true;
        const cleanPhone = val.replace(/[\s\-\(\)]/g, '');
        return bdPhoneRegex.test(cleanPhone);
      }, {
        message: 'Invalid Bangladeshi phone number (e.g. 01XXXXXXXXXX)',
      })
      .optional(),
    address: z.string().optional(),
    details: z.string().optional(),
  }),
});

export const updateUserValidation = z.object({
  body: z.object({
    name: z.string().min(1, 'Name cannot be empty').optional(),
    email: z.string().email('Invalid email address').optional(),
    phone: z.string()
      .refine((val) => {
        if (!val || !val.trim()) return true;
        const cleanPhone = val.replace(/[\s\-\(\)]/g, '');
        return bdPhoneRegex.test(cleanPhone);
      }, {
        message: 'Invalid Bangladeshi phone number (e.g. 01XXXXXXXXXX)',
      })
      .optional(),
    role: z.enum(['super_admin', 'tenant_admin', 'user', 'customer']).optional(),
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
  }),
});

export const UserValidation = {
  updateProfileValidation,
  updateUserValidation,
};
