import { z } from 'zod';

export const createCustomerValidation = z.object({
  body: z.object({
    name: z.string({ message: 'Customer name is required' }).min(1, 'Name cannot be empty'),
    phone: z.string({ message: 'Phone number is required' }).min(1, 'Phone cannot be empty'),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    address: z.string().optional(),
  }),
});

export const CustomerValidation = {
  createCustomerValidation,
};
