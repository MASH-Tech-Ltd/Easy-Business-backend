import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '../database/db';
import { runBackup } from '../database/backup.cron';
import { ensureAllModelsLoaded } from '../database/loadModels';

const execute = async () => {
  console.log('\n--- 🛢️ Manual Database Backup & Replication CLI ---');
  try {
    await connectDatabase();
    ensureAllModelsLoaded();

    const result = await runBackup('manual');

    if (result && result.success) {
      console.log('\n✅ Backup and replication finished successfully!');
      console.log(`📁 Local archive created: ${result.backupFile}`);
      console.log('📊 Replicated collections:', result.recordsDetail);
    } else {
      console.warn('\n⚠️ Backup bypassed or incomplete:', result?.message);
    }
  } catch (err) {
    console.error('\n❌ Backup CLI execution failed:', err);
  } finally {
    await mongoose.connection.close();
    console.log('Primary DB connection closed. Exiting process.\n');
    process.exit(0);
  }
};

execute();
