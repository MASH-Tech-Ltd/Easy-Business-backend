import { z } from 'zod';

export const createCategoryValidation = z.object({
  body: z.object({
    name: z.string({ message: 'Category name is required' }).min(1, 'Name cannot be empty'),
    description: z.string().optional(),
  }),
});

export const updateCategoryValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Category ID is required' }).min(1),
  }),
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }),
});

export const CategoryValidation = {
  createCategoryValidation,
  updateCategoryValidation,
};
