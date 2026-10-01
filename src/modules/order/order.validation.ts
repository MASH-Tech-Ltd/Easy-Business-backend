import { z } from 'zod';

export const createOrderValidation = z.object({
  body: z.object({
    tenantId: z.string({ message: 'tenantId is required' }).min(1),
    customerInfo: z.object({
      name: z.string({ message: 'Customer name is required' }).min(1),
      phone: z.string({ message: 'Phone number is required' }).min(1),
      address: z.string({ message: 'Address is required' }).min(1),
      city: z.string().optional(),
    }),
    items: z.array(z.object({
      productId: z.string({ message: 'ProductId is required' }),
      quantity: z.number().min(1, 'Quantity must be at least 1'),
      price: z.number().min(0),
    })).min(1, 'Order must contain at least 1 item'),
    totalAmount: z.number().min(0),
  }),
});

export const updateOrderValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Order ID is required' }).min(1),
  }),
  body: z.object({
    orderStatus: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']).optional(),
    paymentStatus: z.enum(['pending', 'paid', 'failed', 'refunded']).optional(),
  }),
});

export const OrderValidation = {
  createOrderValidation,
  updateOrderValidation,
};
