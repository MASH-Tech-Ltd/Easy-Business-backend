import { Router } from 'express';
import { 
  createTicket, 
  getMerchantTickets, 
  getAllTickets, 
  getTicketDetails, 
  replyToTicket, 
  updateTicketStatus,
  updateTicketPriority,
  getTicketStats,
  deleteTicket
} from './support.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { SupportValidation } from './support.validation';

const router = Router();

// Merchant routes
router.post('/ticket', authMiddleware('tenant_admin'), validateRequest(SupportValidation.createTicketValidation), createTicket);
router.get('/my-tickets', authMiddleware('tenant_admin'), getMerchantTickets);
router.get('/ticket/:id', authMiddleware('tenant_admin', 'super_admin'), getTicketDetails);
router.post('/ticket/:id/reply', authMiddleware('tenant_admin', 'super_admin'), validateRequest(SupportValidation.replyTicketValidation), replyToTicket);

// Admin routes
router.get('/all-tickets', authMiddleware('super_admin'), getAllTickets);
router.get('/ticket-stats', authMiddleware('super_admin'), getTicketStats);
router.patch('/ticket/:id/status', authMiddleware('super_admin', 'tenant_admin'), validateRequest(SupportValidation.updateTicketStatusValidation), updateTicketStatus);
router.patch('/ticket/:id/priority', authMiddleware('super_admin'), validateRequest(SupportValidation.updateTicketPriorityValidation), updateTicketPriority);
router.delete('/ticket/:id', authMiddleware('super_admin', 'tenant_admin'), deleteTicket);

export const SupportRoutes = router;
