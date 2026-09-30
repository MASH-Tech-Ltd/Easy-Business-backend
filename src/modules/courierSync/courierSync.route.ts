import { Router } from 'express';
import { CourierSyncController } from './courierSync.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// All routes restricted to super_admin
router.post('/run',     authMiddleware('super_admin'), CourierSyncController.runSync);
router.get('/latest',   authMiddleware('super_admin'), CourierSyncController.getLatest);
router.get('/history',  authMiddleware('super_admin'), CourierSyncController.getHistory);
router.get('/report/:id', authMiddleware('super_admin'), CourierSyncController.getById);
router.delete('/report/:id', authMiddleware('super_admin'), CourierSyncController.deleteById);

export const CourierSyncRoutes = router;
