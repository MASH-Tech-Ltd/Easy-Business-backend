import { Router } from 'express';
import { SystemController } from './system.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// SECURITY FIX: All system endpoints require super_admin authentication
router.get('/health', authMiddleware('super_admin'), SystemController.getHealthStats);
router.get('/logs', authMiddleware('super_admin'), SystemController.getLogs);
router.get('/database', authMiddleware('super_admin'), SystemController.getDatabaseStats);
router.get('/security', authMiddleware('super_admin'), SystemController.getSecurityStats);

export const SystemRoutes = router;
