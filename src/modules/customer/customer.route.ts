import { Router } from 'express';
import { CustomerController } from './customer.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

router.post('/create-customer', authMiddleware('tenant_admin'), CustomerController.createCustomer);
router.get('/my-customers', authMiddleware('tenant_admin'), CustomerController.getMyCustomers);

export const CustomerRoutes = router;
