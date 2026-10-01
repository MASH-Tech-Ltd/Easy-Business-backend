import { Router } from 'express';
import { CustomerController } from './customer.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { CustomerValidation } from './customer.validation';

const router = Router();

router.post('/create-customer', authMiddleware('tenant_admin'), validateRequest(CustomerValidation.createCustomerValidation), CustomerController.createCustomer);
router.get('/my-customers', authMiddleware('tenant_admin'), CustomerController.getMyCustomers);

export const CustomerRoutes = router;
