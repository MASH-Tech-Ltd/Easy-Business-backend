import { Router } from 'express';
import { SubscriptionController } from './subscription.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// SECURITY FIX: assign-package now requires super_admin — was previously public,
// allowing anyone to freely upgrade/downgrade any tenant's subscription.
router.post('/assign-package', authMiddleware('super_admin'), SubscriptionController.assignPackage);

// SECURITY FIX: get-tenant-subscription now requires auth.
// tenant_admin can only see their OWN subscription (enforced in controller).
// super_admin can see any tenant's subscription.
router.get('/get-tenant-subscription/:tenantId', authMiddleware('tenant_admin', 'super_admin'), SubscriptionController.getTenantSubscription);

router.get('/my-subscription', authMiddleware('tenant_admin', 'super_admin'), SubscriptionController.getMySubscription);
router.post('/request-package', authMiddleware('tenant_admin', 'super_admin'), SubscriptionController.requestPackage);
router.put('/approve/:id', authMiddleware('super_admin'), SubscriptionController.approveSubscription);
router.put('/reject/:id', authMiddleware('super_admin'), SubscriptionController.rejectSubscription);
router.put('/update/:id', authMiddleware('super_admin'), SubscriptionController.updateSubscription);
router.delete('/delete/:id', authMiddleware('super_admin'), SubscriptionController.deleteSubscription);
router.get('/get-all-subscriptions', authMiddleware('super_admin'), SubscriptionController.getAllSubscriptions);

export const SubscriptionRoutes = router;
