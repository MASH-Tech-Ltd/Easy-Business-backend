import { z } from 'zod';

export const createTicketValidation = z.object({
  body: z.object({
    subject: z.string({ message: 'Subject is required' }).min(3, 'Subject must be at least 3 characters'),
    category: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional().transform(val => val ? val.toUpperCase() : 'MEDIUM'),
    message: z.string({ message: 'Message is required' }).min(1, 'Message cannot be empty').max(2000, 'Message cannot exceed 2000 characters'),
  }),
});

export const replyTicketValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Ticket ID is required' }).min(1),
  }),
  body: z.object({
    message: z.string({ message: 'Reply message is required' }).min(1, 'Message cannot be empty').max(2000, 'Message cannot exceed 2000 characters'),
  }),
});

export const updateTicketStatusValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Ticket ID is required' }).min(1),
  }),
  body: z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], { message: 'Invalid ticket status' })
      .transform(val => val.toUpperCase()),
  }),
});

export const updateTicketPriorityValidation = z.object({
  params: z.object({
    id: z.string({ message: 'Ticket ID is required' }).min(1),
  }),
  body: z.object({
    priority: z.enum(['low', 'medium', 'high', 'urgent', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'], { message: 'Invalid priority level' })
      .transform(val => val.toUpperCase()),
  }),
});

export const SupportValidation = {
  createTicketValidation,
  replyTicketValidation,
  updateTicketStatusValidation,
  updateTicketPriorityValidation,
};
