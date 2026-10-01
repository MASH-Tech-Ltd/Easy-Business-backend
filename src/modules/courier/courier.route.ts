import { Router } from 'express';
import { CourierController } from './courier.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { CourierValidation } from './courier.validation';

const router = Router();

// Storefront gets charges (public)
router.get('/storefront/:tenantId', CourierController.getStorefrontCourierCharge);

// Admin route
router.get('/all-credentials', authMiddleware('super_admin'), CourierController.getAllCredentials);

// Dashboard routes (protected)
router.get('/my-charges', authMiddleware('tenant_admin'), CourierController.getMyCourierCharge);
router.patch('/update-charges', authMiddleware('tenant_admin'), validateRequest(CourierValidation.updateCourierChargeValidation), CourierController.updateCourierCharge);
router.post('/credentials', authMiddleware('tenant_admin'), validateRequest(CourierValidation.saveCredentialsValidation), CourierController.saveCredentials);
router.get('/check-addon', authMiddleware('tenant_admin'), CourierController.checkAddonLimit);
router.post('/forward', authMiddleware('tenant_admin'), validateRequest(CourierValidation.forwardOrderValidation), CourierController.forwardOrder);
router.post('/sync-status', authMiddleware('super_admin'), CourierController.syncCourierStatuses);

export const CourierRoutes = router;
