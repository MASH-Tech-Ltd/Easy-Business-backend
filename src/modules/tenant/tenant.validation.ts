import { z } from 'zod';

export const createTenantValidation = z.object({
  body: z.object({
    storeName: z.string({ message: 'Store name is required' }).min(2),
    storeSlug: z.string({ message: 'Store slug is required' }).min(2),
    ownerName: z.string({ message: 'Owner name is required' }),
    email: z.string({ message: 'Email is required' }).email(),
    phone: z.string({ message: 'Phone is required' }),
    password: z.string({ message: 'Password is required' }).min(6),
  }),
});

export const updateStoreValidation = z.object({
  body: z.object({
    storeName: z.string().optional(),
    domain: z.string().optional(),
    // Add other fields as necessary
  }),
});
