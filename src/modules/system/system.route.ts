import { Router } from 'express';
import { SystemController } from './system.controller';
import { RedisMonitoringController } from './redisMonitoring.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// SECURITY FIX: All system endpoints require super_admin authentication
router.get('/health', authMiddleware('super_admin'), SystemController.getHealthStats);
router.get('/logs', authMiddleware('super_admin'), SystemController.getLogs);
router.get('/database', authMiddleware('super_admin'), SystemController.getDatabaseStats);
router.post('/database/sync', authMiddleware('super_admin'), SystemController.syncDatabaseData);
router.get('/database/backup-logs', authMiddleware('super_admin'), SystemController.getBackupLogs);
router.get('/database/backup-files', authMiddleware('super_admin'), SystemController.getBackupFiles);
router.get('/database/download-backup/:filename', authMiddleware('super_admin'), SystemController.downloadBackupFile);
router.get('/security', authMiddleware('super_admin'), SystemController.getSecurityStats);

// New Security & Blocklist Routes
router.get('/security/logs', authMiddleware('super_admin'), SystemController.getSecurityLogs);
router.get('/security/blocked-ips', authMiddleware('super_admin'), SystemController.getBlockedIps);
router.post('/security/block-ip', authMiddleware('super_admin'), SystemController.blockIp);
router.delete('/security/blocked-ips/:ip', authMiddleware('super_admin'), SystemController.unblockIp);
router.post('/security/sync', authMiddleware('super_admin'), SystemController.syncIpCache);

router.get('/security/visitor-logs', authMiddleware('super_admin'), SystemController.getVisitorLogs);
router.post('/security/visitor-logs', SystemController.createVisitorLog);
router.delete('/security/visitor-logs', authMiddleware('super_admin'), SystemController.clearVisitorLogs);

// Global Settings & Platform Configuration
router.get('/global-settings', authMiddleware('super_admin'), SystemController.getGlobalSettings);
router.put('/global-settings', authMiddleware('super_admin'), SystemController.updateGlobalSettings);
router.get('/public-settings', SystemController.getPublicSettings);
router.get('/active-stores', SystemController.getActiveStoresForSeo);
router.get('/theme-previews', SystemController.getThemePreviews);

// Redis & Cache Monitoring (Super Admin only)
router.get('/redis/overview', authMiddleware('super_admin'), RedisMonitoringController.getOverview);
router.get('/redis/memory', authMiddleware('super_admin'), RedisMonitoringController.getMemory);
router.get('/redis/stats', authMiddleware('super_admin'), RedisMonitoringController.getStats);
router.get('/redis/cache-analytics', authMiddleware('super_admin'), RedisMonitoringController.getCacheAnalytics);
router.get('/redis/api-performance', authMiddleware('super_admin'), RedisMonitoringController.getApiPerformance);
router.get('/redis/top-endpoints', authMiddleware('super_admin'), RedisMonitoringController.getTopEndpoints);
router.get('/redis/health', authMiddleware('super_admin'), RedisMonitoringController.getHealth);
router.post('/redis/cache/clear', authMiddleware('super_admin'), RedisMonitoringController.clearAllCache);
router.post('/redis/cache/clear-group', authMiddleware('super_admin'), RedisMonitoringController.clearCacheGroup);
router.post('/redis/cache/clear-store', authMiddleware('super_admin'), RedisMonitoringController.clearStoreCache);

export const SystemRoutes = router;
