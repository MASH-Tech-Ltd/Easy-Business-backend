import { Router } from 'express';
import { TrackingController } from './tracking.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { trackPlatformBrowserEventSchema } from './tracking.validation';

const router = Router();

// Merchant tracking management routes (strictly merchant-scoped, untouched)
router.get('/merchant', authMiddleware('tenant_admin'), TrackingController.getMerchantTrackingConfig);
router.put('/merchant', authMiddleware('tenant_admin'), TrackingController.updateMerchantTrackingConfig);
router.post('/merchant/test', authMiddleware('tenant_admin'), TrackingController.testMerchantTrackingConfig);

// Public Platform Meta Pixel / CAPI endpoints (strictly MASH ECO platform only)
router.get('/platform/public', TrackingController.getPublicPlatformTrackingConfig);
router.post('/platform/events', validateRequest(trackPlatformBrowserEventSchema), TrackingController.trackPlatformBrowserEvent);

// Platform tracking management routes (Super Admin)
router.get('/platform', authMiddleware('super_admin'), TrackingController.getPlatformTrackingConfig);
router.put('/platform', authMiddleware('super_admin'), TrackingController.updatePlatformTrackingConfig);
router.post('/platform/test-capi', authMiddleware('super_admin'), TrackingController.testPlatformMetaCapi);

export const TrackingRoutes = router;
