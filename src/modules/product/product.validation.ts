import { z } from 'zod';

export const createProductValidation = z.object({
  body: z.object({
    title: z.string({ message: 'Product title is required' }).min(1, 'Product title cannot be empty').optional(),
    name: z.string().optional(),
    originalPrice: z.union([z.string(), z.number()]).optional(),
    discountedPrice: z.union([z.string(), z.number()]).optional(),
    price: z.union([z.string(), z.number()]).optional(),
    saveAmount: z.union([z.string(), z.number()]).optional(),
    stock: z.union([z.string(), z.number()]).optional(),
    description: z.string().optional(),
    shortDescription: z.string().optional(),
    categoryId: z.string().optional(),
    brand: z.string().optional(),
    weight: z.union([z.string(), z.number()]).optional(),
    length: z.union([z.string(), z.number()]).optional(),
    width: z.union([z.string(), z.number()]).optional(),
    height: z.union([z.string(), z.number()]).optional(),
    condition: z.string().optional(),
    status: z.string().optional(),
    sku: z.string().optional(),
    unit: z.string().optional(),
    isAuthentic: z.union([z.boolean(), z.string()]).optional(),
    badgeText: z.string().optional(),
    features: z.union([z.string(), z.array(z.string())]).optional(),
    videos: z.union([z.string(), z.array(z.string())]).optional(),
    specifications: z.union([z.string(), z.array(z.any())]).optional(),
    dimensions: z.union([z.string(), z.object({
      length: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })]).optional(),
  }).refine((data) => !!(data.title || data.name), {
    message: 'Product name/title is required',
    path: ['title'],
  }).refine((data) => (data.discountedPrice !== undefined || data.originalPrice !== undefined || data.price !== undefined), {
    message: 'Product price is required',
    path: ['price'],
  }),
});

export const updateProductValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Product ID is required' }).min(1),
  }),
  body: z.object({
    title: z.string().optional(),
    name: z.string().optional(),
    originalPrice: z.union([z.string(), z.number()]).optional(),
    discountedPrice: z.union([z.string(), z.number()]).optional(),
    price: z.union([z.string(), z.number()]).optional(),
    saveAmount: z.union([z.string(), z.number()]).optional(),
    stock: z.union([z.string(), z.number()]).optional(),
    description: z.string().optional(),
    shortDescription: z.string().optional(),
    categoryId: z.string().optional(),
    brand: z.string().optional(),
    weight: z.union([z.string(), z.number()]).optional(),
    length: z.union([z.string(), z.number()]).optional(),
    width: z.union([z.string(), z.number()]).optional(),
    height: z.union([z.string(), z.number()]).optional(),
    condition: z.string().optional(),
    status: z.string().optional(),
    sku: z.string().optional(),
    unit: z.string().optional(),
    isAuthentic: z.union([z.boolean(), z.string()]).optional(),
    badgeText: z.string().optional(),
    features: z.union([z.string(), z.array(z.string())]).optional(),
    videos: z.union([z.string(), z.array(z.string())]).optional(),
    specifications: z.union([z.string(), z.array(z.any())]).optional(),
    existingImages: z.string().optional(),
    imageManifest: z.string().optional(),
    dimensions: z.union([z.string(), z.object({
      length: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })]).optional(),
  }),
});

export const ProductValidation = {
  createProductValidation,
  updateProductValidation,
};
