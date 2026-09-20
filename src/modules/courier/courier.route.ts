import { Router } from 'express';
import { CourierController } from './courier.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Storefront gets charges (public)
router.get('/storefront/:tenantId', CourierController.getStorefrontCourierCharge);

// Admin route
router.get('/all-credentials', authMiddleware('super_admin'), CourierController.getAllCredentials);

// Dashboard routes (protected)
router.get('/my-charges', authMiddleware('tenant_admin'), CourierController.getMyCourierCharge);
router.patch('/update-charges', authMiddleware('tenant_admin'), CourierController.updateCourierCharge);
router.post('/credentials', authMiddleware('tenant_admin'), CourierController.saveCredentials);
router.get('/check-addon', authMiddleware('tenant_admin'), CourierController.checkAddonLimit);
router.post('/forward', authMiddleware('tenant_admin'), CourierController.forwardOrder);

export const CourierRoutes = router;
