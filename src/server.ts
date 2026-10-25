import app from './app';
import config from './config/index';
import { connectDatabase } from './database/db';
import { seedSuperAdmin } from './utils/seedSuperAdmin';
import { seedDemoStorefront } from './utils/seedStorefront';
import { ensurePackageFreeCredits } from './utils/ensurePackageFreeCredits';
import { ensureAddons } from './utils/ensureAddons';
import { BlogService } from './modules/blog/blog.service';

import { initSocket } from './socket';
import { initCourierCron } from './modules/courier/courier.cron';
import { initBackupCron } from './database/backup.cron';

const PORT = config.app.port || 8000;

connectDatabase()
  .then(async () => {
    await seedSuperAdmin();
    await ensurePackageFreeCredits();
    await ensureAddons();
    await BlogService.seedInitialBlogs();
    const server = app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
    
    // Initialize Socket.io
    initSocket(server);

    // Initialize Background Cron Jobs
    initCourierCron();
    initBackupCron();
  })
  .catch((error: unknown) => {
    console.error("Database connection failed!!", error);
    process.exit(1);
  });
