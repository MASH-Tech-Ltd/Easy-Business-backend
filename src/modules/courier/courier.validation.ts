import { z } from 'zod';

export const updateCourierChargeValidation = z.object({
  body: z.object({
    insideDhaka: z.number().min(0).optional(),
    outsideDhaka: z.number().min(0).optional(),
    suburb: z.number().min(0).optional(),
  }),
});

export const saveCredentialsValidation = z.object({
  body: z.object({
    provider: z.string({ message: 'Courier provider is required' }).min(1),
    apiKey: z.string().optional(),
    secretKey: z.string().optional(),
  }),
});

export const forwardOrderValidation = z.object({
  body: z.object({
    orderId: z.string({ message: 'orderId is required' }).min(1),
    provider: z.string({ message: 'Courier provider is required' }).min(1),
  }),
});

export const CourierValidation = {
  updateCourierChargeValidation,
  saveCredentialsValidation,
  forwardOrderValidation,
};
