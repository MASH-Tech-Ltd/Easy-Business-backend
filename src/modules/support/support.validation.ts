import { z } from 'zod';

export const createTicketValidation = z.object({
  body: z.object({
    subject: z.string({ message: 'Subject is required' }).min(3, 'Subject must be at least 3 characters'),
    category: z.string({ message: 'Category is required' }).min(1),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    message: z.string({ message: 'Message is required' }).min(5, 'Message must be at least 5 characters').max(1000, 'Message cannot exceed 1000 characters'),
  }),
});

export const replyTicketValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Ticket ID is required' }).min(1),
  }),
  body: z.object({
    message: z.string({ message: 'Reply message is required' }).min(1, 'Message cannot be empty').max(1000, 'Message cannot exceed 1000 characters'),
  }),
});

export const updateTicketStatusValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Ticket ID is required' }).min(1),
  }),
  body: z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed'], { message: 'Invalid ticket status' }),
  }),
});

export const updateTicketPriorityValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Ticket ID is required' }).min(1),
  }),
  body: z.object({
    priority: z.enum(['low', 'medium', 'high', 'urgent'], { message: 'Invalid priority level' }),
  }),
});

export const SupportValidation = {
  createTicketValidation,
  replyTicketValidation,
  updateTicketStatusValidation,
  updateTicketPriorityValidation,
};
