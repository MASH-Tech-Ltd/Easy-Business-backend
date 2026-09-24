import { Router } from 'express';
import { SystemController } from './system.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// SECURITY FIX: All system endpoints require super_admin authentication
router.get('/health', authMiddleware('super_admin'), SystemController.getHealthStats);
router.get('/logs', authMiddleware('super_admin'), SystemController.getLogs);
router.get('/database', authMiddleware('super_admin'), SystemController.getDatabaseStats);
router.get('/security', authMiddleware('super_admin'), SystemController.getSecurityStats);

// New Security & Blocklist Routes
router.get('/security/logs', authMiddleware('super_admin'), SystemController.getSecurityLogs);
router.get('/security/blocked-ips', authMiddleware('super_admin'), SystemController.getBlockedIps);
router.post('/security/block-ip', authMiddleware('super_admin'), SystemController.blockIp);
router.delete('/security/blocked-ips/:ip', authMiddleware('super_admin'), SystemController.unblockIp);
router.post('/security/sync', authMiddleware('super_admin'), SystemController.syncIpCache);

router.get('/security/visitor-logs', authMiddleware('super_admin'), SystemController.getVisitorLogs);
router.post('/security/visitor-logs', SystemController.createVisitorLog);

export const SystemRoutes = router;
