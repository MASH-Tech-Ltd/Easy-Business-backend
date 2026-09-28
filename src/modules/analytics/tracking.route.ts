import { Router } from 'express';
import { TrackingController } from './tracking.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Merchant tracking management routes
router.get('/merchant', authMiddleware('tenant_admin'), TrackingController.getMerchantTrackingConfig);
router.put('/merchant', authMiddleware('tenant_admin'), TrackingController.updateMerchantTrackingConfig);
router.post('/merchant/test', authMiddleware('tenant_admin'), TrackingController.testMerchantTrackingConfig);

// Platform tracking management routes (Super Admin)
router.get('/platform', authMiddleware('super_admin'), TrackingController.getPlatformTrackingConfig);
router.put('/platform', authMiddleware('super_admin'), TrackingController.updatePlatformTrackingConfig);

export const TrackingRoutes = router;
