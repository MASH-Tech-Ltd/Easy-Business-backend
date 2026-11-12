import { z } from 'zod';

const checkoutLeadItemSchema = z.object({
  productId: z.string().trim().max(100).optional(),
  title: z.string({ message: 'Product title is required' }).trim().min(1).max(200),
  price: z.coerce.number().min(0).optional(),
  quantity: z.coerce.number().int().min(1).max(999).optional(),
  image: z.string().trim().max(500).optional(),
  color: z.string().trim().max(100).optional(),
  size: z.string().trim().max(100).optional(),
});

export const trackLeadValidation = z.object({
  body: z.object({
    firstName: z.string().trim().max(120).optional(),
    lastName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(120).optional(),
    address: z.string().trim().max(500).optional(),
    division: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    upazila: z.string().trim().max(100).optional(),
    items: z.array(checkoutLeadItemSchema).max(50).optional(),
    subTotal: z.coerce.number().min(0).optional(),
    status: z.enum(['abandoned', 'completed']).optional(),
  }),
});

export const getMerchantLeadsValidation = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().max(100).optional(),
    status: z.enum(['all', 'abandoned', 'completed']).optional(),
  }),
});
