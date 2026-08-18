import { Router } from 'express';
import { SubscriptionController } from './subscription.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// In the future, protect these with authMiddleware('super_admin')
router.post('/assign-package', SubscriptionController.assignPackage);
router.get('/get-tenant-subscription/:tenantId', SubscriptionController.getTenantSubscription);
router.get('/my-subscription', authMiddleware('tenant_admin', 'super_admin'), SubscriptionController.getMySubscription);
router.post('/request-package', authMiddleware('tenant_admin', 'super_admin'), SubscriptionController.requestPackage);
router.put('/approve/:id', authMiddleware('super_admin'), SubscriptionController.approveSubscription);
router.put('/reject/:id', authMiddleware('super_admin'), SubscriptionController.rejectSubscription);
router.put('/update/:id', authMiddleware('super_admin'), SubscriptionController.updateSubscription);
router.delete('/delete/:id', authMiddleware('super_admin'), SubscriptionController.deleteSubscription);
router.get('/get-all-subscriptions', authMiddleware('super_admin'), SubscriptionController.getAllSubscriptions);

export const SubscriptionRoutes = router;
