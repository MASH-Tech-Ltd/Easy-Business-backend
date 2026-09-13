import app from './app';
import config from './config/index';
import { connectDatabase } from './database/db';
import { seedSuperAdmin } from './utils/seedSuperAdmin';
import { seedDemoStorefront } from './utils/seedStorefront';

import { initSocket } from './socket';

const PORT = config.port || 8000;

connectDatabase()
  .then(async () => {
    await seedSuperAdmin();
    const server = app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
    
    // Initialize Socket.io
    initSocket(server);
  })
  .catch((error: unknown) => {
    console.error("Database connection failed!!", error);
    process.exit(1);
  });
