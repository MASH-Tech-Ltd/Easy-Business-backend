import app from './app';
import config from './config/index';
import { connectDatabase } from './database/db';
import { seedSuperAdmin } from './utils/seedSuperAdmin';
import { ensurePackageFreeCredits } from './utils/ensurePackageFreeCredits';
import { ensureAddons } from './utils/ensureAddons';
import { BlogService } from './modules/blog/blog.service';

import { initSocket } from './socket';
import { initCourierCron } from './modules/courier/courier.cron';
import { initBackupCron } from './database/backup.cron';
import { initSubscriptionCron } from './modules/subscription/subscription.cron';
import { initPlatformCapiCron } from './modules/analytics/platformCapi.service';
import { initTenantCapiCron } from './modules/analytics/tenantCapi.service';
import { initMediaCron } from './modules/media/media.cron';
import { validateMediaConfig } from './modules/media/providers';
import { initResourceCron } from './modules/resource/resource.cron';
import { initRedis, closeRedis } from './infrastructure/redis/redis.client';

const PORT = Number(config.app.port) || 8000;
const HOST = process.env.HOST?.trim();

connectDatabase()
  .then(async () => {
    await initRedis();
    await seedSuperAdmin();
    await ensurePackageFreeCredits();
    await ensureAddons();
    await BlogService.seedInitialBlogs();
    const onListening = () => {
      console.log(`Server running at http://${HOST || 'localhost'}:${PORT}`);
    };
    const server = HOST
      ? app.listen(PORT, HOST, onListening)
      : app.listen(PORT, onListening);
    
    // Initialize Socket.io
    initSocket(server);

    // Initialize Background Cron Jobs
    validateMediaConfig();
    initCourierCron();
    initBackupCron();
    initSubscriptionCron();
    initPlatformCapiCron();
    initTenantCapiCron();
    initMediaCron();
    initResourceCron();

    const shutdown = async (signal: string) => {
      console.log(`[Server] ${signal} received. Closing HTTP server and Redis...`);
      server.close(async () => {
        await closeRedis();
        process.exit(0);
      });
      setTimeout(async () => {
        await closeRedis();
        process.exit(0);
      }, 5000).unref();
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  })
  .catch((error: unknown) => {
    console.error("Database connection failed!!", error);
    process.exit(1);
  });
