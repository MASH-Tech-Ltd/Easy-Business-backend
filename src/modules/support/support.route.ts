import { Router } from 'express';
import { 
  createTicket, 
  getMerchantTickets, 
  getAllTickets, 
  getTicketDetails, 
  replyToTicket, 
  updateTicketStatus,
  deleteTicket
} from './support.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Merchant routes
router.post('/ticket', authMiddleware('tenant_admin'), createTicket);
router.get('/my-tickets', authMiddleware('tenant_admin'), getMerchantTickets);
router.get('/ticket/:id', authMiddleware('tenant_admin', 'super_admin'), getTicketDetails);
router.post('/ticket/:id/reply', authMiddleware('tenant_admin', 'super_admin'), replyToTicket);

// Admin routes
router.get('/all-tickets', authMiddleware('super_admin'), getAllTickets);
router.patch('/ticket/:id/status', authMiddleware('super_admin', 'tenant_admin'), updateTicketStatus);
router.delete('/ticket/:id', authMiddleware('super_admin', 'tenant_admin'), deleteTicket);

export const SupportRoutes = router;
