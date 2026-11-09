import { Router } from 'express';
import { CustomerController } from './customer.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { manualOrderLimiter, dashboardLimiter } from '../../middleware/rateLimiter';
import { validateRequest } from '../../middleware/validateRequest';
import { CustomerValidation } from './customer.validation';

const router = Router();

router.post('/create-customer', authMiddleware('tenant_admin'), dashboardLimiter, validateRequest(CustomerValidation.createCustomerValidation), CustomerController.createCustomer);
router.get('/my-customers', authMiddleware('tenant_admin'), manualOrderLimiter, CustomerController.getMyCustomers);

export const CustomerRoutes = router;
