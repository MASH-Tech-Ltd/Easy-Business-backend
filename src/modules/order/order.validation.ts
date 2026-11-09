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

export const MANUAL_ORDER_SOURCES = [
  'Facebook',
  'Messenger',
  'WhatsApp',
  'Phone Call',
  'Instagram',
  'Walk-in',
  'Other',
] as const;

export const createManualOrderValidation = z.object({
  body: z.object({
    customerName: z.string({ message: 'Customer name is required' }).trim().min(2, 'Customer name must be at least 2 characters'),
    customerPhone: z
      .string({ message: 'Customer phone is required' })
      .trim()
      .regex(/^(?:\+?88|88)?01[3-9]\d{8}$/, 'Please enter a valid 11-digit BD phone number (e.g. 01712345678)'),
    customerEmail: z.string().email('Invalid email address').optional().or(z.literal('')),
    shippingAddress: z.string({ message: 'Shipping address is required' }).trim().min(5, 'Please provide a complete delivery address'),
    note: z.string().optional(),
    orderSource: z.enum(MANUAL_ORDER_SOURCES, {
      message: 'Please select a valid order source',
    }),
    items: z
      .array(
        z.object({
          productId: z.string({ message: 'ProductId is required' }).min(1),
          variantId: z.string().optional(),
          color: z.string().optional(),
          size: z.string().optional(),
          title: z.string().optional(),
          price: z.number().min(0).optional(),
          quantity: z.number().int().min(1, 'Quantity must be at least 1'),
          image: z.string().optional(),
        })
      )
      .min(1, 'Order must contain at least 1 product'),
    discount: z.number().min(0).optional(),
    shippingCharge: z.number().min(0).optional(),
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
    discount: z.number().min(0).optional(),
    shippingCharge: z.number().min(0).optional(),
    subTotal: z.number().min(0).optional(),
    totalPrice: z.number().min(0).optional(),
    isDeliveryChargePaid: z.boolean().optional(),
    items: z.array(z.any()).optional(),
  }),
});

export const OrderValidation = {
  createOrderValidation,
  createManualOrderValidation,
  updateOrderValidation,
};
