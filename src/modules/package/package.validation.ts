import { z } from 'zod';

export const createPackageValidation = z.object({
  body: z.object({
    name: z.string({ message: 'Package name is required' }).min(2, 'Name is too short'),
    price: z.number({ message: 'Price is required' }).min(0, 'Price cannot be negative'),
    billingCycle: z.enum(['monthly', 'yearly'], { message: 'Billing cycle is required (monthly/yearly)' }),
    productLimit: z.number({ message: 'Product limit is required' }).min(1, 'Product limit must be at least 1'),
    features: z.array(z.string()).optional(),
    tagline: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    isPopular: z.boolean().optional(),
  }),
});

export const updatePackageValidation = z.object({
  body: z.object({
    name: z.string().min(2, 'Name is too short').optional(),
    price: z.number().min(0, 'Price cannot be negative').optional(),
    billingCycle: z.enum(['monthly', 'yearly']).optional(),
    productLimit: z.number().min(1, 'Product limit must be at least 1').optional(),
    features: z.array(z.string()).optional(),
    tagline: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    isPopular: z.boolean().optional(),
  }),
});
