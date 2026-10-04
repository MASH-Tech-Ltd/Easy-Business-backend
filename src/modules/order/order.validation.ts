import { z } from 'zod';

export const createOrderValidation = z.object({
  body: z.object({
    customerName: z.string({ message: 'Customer name is required' }).min(1, 'Customer name cannot be empty'),
    customerPhone: z.string({ message: 'Customer phone is required' }).min(1, 'Customer phone cannot be empty'),
    shippingAddress: z.string({ message: 'Shipping address is required' }).min(1, 'Shipping address cannot be empty'),
    note: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string({ message: 'ProductId is required' }).min(1),
          title: z.string().optional(),
          price: z.number().min(0).optional(),
          quantity: z.number().min(1, 'Quantity must be at least 1'),
          image: z.string().optional(),
        })
      )
      .min(1, 'Order must contain at least 1 item'),
    tenantId: z.string().optional(),
    subTotal: z.number().min(0).optional(),
    shippingCharge: z.number().min(0).optional(),
    totalPrice: z.number().min(0).optional(),
    isDeliveryChargePaid: z.boolean().optional(),
    paymentStatus: z.enum(['unpaid', 'paid']).optional(),
  }),
});

export const updateOrderValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Order ID is required' }).min(1),
  }),
  body: z.object({
    status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned']).optional(),
    paymentStatus: z.enum(['unpaid', 'paid', 'failed', 'refunded']).optional(),
  }),
});

export const OrderValidation = {
  createOrderValidation,
  updateOrderValidation,
};
