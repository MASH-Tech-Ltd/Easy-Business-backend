import { Router } from 'express';
import { createInquiry, getAllInquiries, updateInquiryStatus, deleteInquiry } from './contactInquiry.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

import { customRateLimit } from '../../middleware/rateLimiter';

const router = Router();

const createInquiryLimiter = customRateLimit(15 * 60 * 1000, 15, 'Too many inquiries from this IP, please try again after 15 minutes.');

// Public route for landing page
router.post('/create-inquiry', createInquiryLimiter, createInquiry);

// Admin routes
router.get('/get-all-inquiries', authMiddleware('super_admin'), getAllInquiries);
router.patch('/update-inquiry-status/:id', authMiddleware('super_admin'), updateInquiryStatus);
router.delete('/delete-inquiry/:id', authMiddleware('super_admin'), deleteInquiry);

export const ContactInquiryRoutes = router;
