import { Router } from 'express';
import { SubscriptionController } from './subscription.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { SubscriptionValidation } from './subscription.validation';

const router = Router();

// SECURITY FIX: assign-package now requires super_admin — was previously public,
// allowing anyone to freely upgrade/downgrade any tenant's subscription.
router.post('/assign-package', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.assignPackageValidation), SubscriptionController.assignPackage);

// SECURITY FIX: get-tenant-subscription now requires auth.
// tenant_admin can only see their OWN subscription (enforced in controller).
// super_admin can see any tenant's subscription.
router.get('/get-tenant-subscription/:tenantId', authMiddleware('tenant_admin', 'super_admin'), validateRequest(SubscriptionValidation.tenantIdParamValidation), SubscriptionController.getTenantSubscription);

router.get('/my-subscription', authMiddleware('tenant_admin', 'super_admin'), SubscriptionController.getMySubscription);
router.post('/request-package', authMiddleware('tenant_admin', 'super_admin'), validateRequest(SubscriptionValidation.requestPackageValidation), SubscriptionController.requestPackage);
router.put('/approve/:id', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.subscriptionIdParamValidation), SubscriptionController.approveSubscription);
router.put('/reject/:id', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.subscriptionIdParamValidation), SubscriptionController.rejectSubscription);
router.put('/update/:id', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.updateSubscriptionValidation), SubscriptionController.updateSubscription);
router.delete('/delete/:id', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.subscriptionIdParamValidation), SubscriptionController.deleteSubscription);
router.get('/get-all-subscriptions', authMiddleware('super_admin'), SubscriptionController.getAllSubscriptions);

router.post('/addons/purchase', authMiddleware('tenant_admin'), validateRequest(SubscriptionValidation.purchaseAddonValidation), SubscriptionController.purchaseAddon);
router.get('/addons/requests', authMiddleware('super_admin'), SubscriptionController.getAllAddonRequests);
router.put('/addons/:subscriptionId/:addonId/approve', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.addonActionParamValidation), SubscriptionController.approveAddonRequest);
router.put('/addons/:subscriptionId/:addonId/deactivate', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.addonActionParamValidation), SubscriptionController.deactivateAddonRequest);
router.put('/addons/:subscriptionId/:addonId/reactivate', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.addonActionParamValidation), SubscriptionController.reactivateAddonRequest);
router.put('/addons/:subscriptionId/:addonId/extend', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.extendAddonLimitValidation), SubscriptionController.extendAddonLimit);
router.put('/addons/:subscriptionId/:addonId/terminate', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.addonActionParamValidation), SubscriptionController.terminateAddonRequest);
router.put('/addons/:subscriptionId/:addonId/reject', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.addonActionParamValidation), SubscriptionController.rejectAddonRequest);
router.delete('/addons/:subscriptionId/:addonId', authMiddleware('super_admin'), validateRequest(SubscriptionValidation.addonActionParamValidation), SubscriptionController.removeAddon);

export const SubscriptionRoutes = router;
