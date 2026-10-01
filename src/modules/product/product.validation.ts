import { z } from 'zod';

export const createProductValidation = z.object({
  body: z.object({
    name: z.string({ message: 'Product name is required' }).min(1, 'Name cannot be empty'),
    price: z.union([z.string(), z.number()]),
    stock: z.union([z.string(), z.number()]).optional(),
    description: z.string().optional(),
    categoryId: z.string().optional(),
  }),
});

export const updateProductValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Product ID is required' }).min(1),
  }),
  body: z.object({
    name: z.string().optional(),
    price: z.union([z.string(), z.number()]).optional(),
    stock: z.union([z.string(), z.number()]).optional(),
    description: z.string().optional(),
    categoryId: z.string().optional(),
  }),
});

export const ProductValidation = {
  createProductValidation,
  updateProductValidation,
};
