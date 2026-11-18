import { z } from 'zod';

export const createBlogValidation = z.object({
  body: z.object({
    title: z.string({ message: 'Title is required' }).min(3, 'Title must be at least 3 characters'),
    excerpt: z.string({ message: 'Excerpt is required' }).min(10, 'Excerpt must be at least 10 characters'),
    content: z.string({ message: 'Content is required' }).min(20, 'Content must be at least 20 characters'),
    category: z.string().optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    author: z.string().optional(),
    authorRole: z.string().optional(),
    readTime: z.string().optional(),
    isPublished: z.union([z.boolean(), z.string()]).optional(),
    featured: z.union([z.boolean(), z.string()]).optional(),
    thumbnail: z.string().optional(),
  }),
});

export const updateBlogValidation = z.object({
  body: z.object({
    title: z.string().min(3).optional(),
    excerpt: z.string().min(10).optional(),
    content: z.string().min(20).optional(),
    category: z.string().optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    author: z.string().optional(),
    authorRole: z.string().optional(),
    readTime: z.string().optional(),
    isPublished: z.union([z.boolean(), z.string()]).optional(),
    featured: z.union([z.boolean(), z.string()]).optional(),
    thumbnail: z.string().optional(),
  }),
});
