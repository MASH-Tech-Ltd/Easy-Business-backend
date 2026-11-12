import { z } from 'zod';

export const blockPhoneValidation = z.object({
  body: z.object({
    phone: z
      .string({ message: 'Phone number is required' })
      .trim()
      .min(6, 'Phone number must be at least 6 characters')
      .max(30, 'Phone number is too long'),
    customerName: z.string().trim().max(120, 'Customer name is too long').optional(),
    reason: z.string().trim().max(300, 'Reason must be at most 300 characters').optional(),
  }),
});

export const unblockPhoneValidation = z.object({
  params: z.object({
    phone: z.string({ message: 'Phone number or ID is required' }).trim().min(1).max(64),
  }),
});

export const getBlockedPhonesValidation = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().max(100).optional(),
  }),
});

