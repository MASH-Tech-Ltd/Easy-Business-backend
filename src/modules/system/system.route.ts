import { Router } from 'express';
import { SystemController } from './system.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// These should ideally be protected by authMiddleware('super_admin')
router.get('/health', SystemController.getHealthStats);
router.get('/logs', SystemController.getLogs);
router.get('/database', SystemController.getDatabaseStats);
router.get('/security', SystemController.getSecurityStats);

export const SystemRoutes = router;
