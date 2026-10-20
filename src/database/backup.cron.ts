import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import cron from 'node-cron';
import config from '../config/index';
import { BackupLogModel } from './backupLog.model';
import { ensureAllModelsLoaded } from './loadModels';

export interface BackupResult {
  success: boolean;
  message?: string;
  timestamp: string;
  backupFile?: string;
  recordsDetail?: Record<string, number>;
}

export const runBackup = async (
  triggerType: 'manual' | 'scheduled' = 'scheduled'
): Promise<BackupResult> => {
  console.log(`[Backup] Starting ${triggerType} backup process at ${new Date().toISOString()}`);

  // Ensure all models are loaded in mongoose
  ensureAllModelsLoaded();

  let timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let backupFilePath = '';
  const recordsDetail: Record<string, number> = {};

  try {
    const primaryDb = mongoose.connection.db;
    if (!primaryDb) throw new Error("Primary database connection is not established");

    // Discover all real collections in primary database (guarantees all 26 collections are found)
    const rawCollections = await primaryDb.listCollections().toArray();
    const collectionsToBackup = rawCollections
      .filter((c) => !c.name.startsWith('system.'))
      .map((c) => c.name);

    let totalRecords = 0;

    for (const collName of collectionsToBackup) {
      if (collName === 'backuplogs') continue;
      try {
        const count = await primaryDb.collection(collName).countDocuments();
        recordsDetail[collName] = count;
        totalRecords += count;
        console.log(`[Backup] Counted ${count} records for collection ${collName}`);
      } catch (err: any) {
        console.error(`[Backup] Failed to count collection ${collName}:`, err.message);
      }
    }

    // --- PRE-SAVE SAFEGUARDS ---

    // 1. Empty Database Check
    if (totalRecords === 0) {
      const errorMsg =
        '[Backup] Safeguard Triggered: Primary database is completely empty (0 records). Aborting to protect backups.';
      console.error(errorMsg);
      await BackupLogModel.create({
        status: 'bypassed',
        triggerType,
        message: errorMsg,
        timestamp: new Date(),
      });
      return { success: false, message: errorMsg, timestamp, backupFile: '' };
    }

    // 2. Ransomware / Corruption Canary Safeguard
    const userColl = primaryDb.collection('users');
    if (userColl) {
      const samples = await userColl.find({}).limit(50).toArray();
      const sampleSize = samples.length;
      let validEmails = 0;

      for (const item of samples as any[]) {
        if (item && typeof item.email === 'string' && item.email.includes('@')) {
          validEmails++;
        }
      }

      if (validEmails === 0 && sampleSize > 0) {
        const errorMsg = `[Backup] RANSOMWARE DETECTED: Sampled ${sampleSize} records but found 0 valid emails. Data appears encrypted/corrupted. Sync aborted!`;
        console.error(errorMsg);
        await BackupLogModel.create({
          status: 'failed',
          recordsDetail,
          triggerType,
          message: errorMsg,
          timestamp: new Date(),
        });
        return { success: false, message: errorMsg, timestamp, backupFile: '' };
      }
    }

    // 3. Historical Data Loss Detection
    try {
      const lastBackup = await BackupLogModel.findOne({ status: 'success' })
        .sort({ timestamp: -1 })
        .lean();
      if (lastBackup && lastBackup.recordsDetail) {
        const lastTotalRecords = Object.values(lastBackup.recordsDetail).reduce(
          (sum: number, count: any) => sum + (Number(count) || 0),
          0
        );

        if (lastTotalRecords > 100 && totalRecords < lastTotalRecords * 0.5) {
          const errorMsg = `[Backup] MASSIVE DATA LOSS DETECTED: Primary DB has ${totalRecords} records, but last successful backup had ${lastTotalRecords}. Aborting to protect previous backups!`;
          console.error(errorMsg);
          await BackupLogModel.create({
            status: 'failed',
            recordsDetail,
            triggerType,
            message: errorMsg,
            timestamp: new Date(),
          });
          return { success: false, message: errorMsg, timestamp, backupFile: '' };
        }
      }
    } catch (historyErr) {
      console.warn('[Backup] Could not retrieve backup history for data loss check.', historyErr);
    }

    // --- EXECUTE BACKUP & REPLICATION ---

    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupFilePath = path.join(backupsDir, `backup-${timestamp}.json.gz`);

    const writeStream = fs.createWriteStream(backupFilePath);
    const gzip = zlib.createGzip();
    gzip.pipe(writeStream);

    // Start JSON structure
    gzip.write('{\n');
    let isFirstModel = true;

    // Connect to secondary MongoDB cluster for replication
    let secondaryConn: mongoose.Connection | null = null;
    const backupMongoUri = config.database.backupUrl || process.env.BACKUP_DATABASE_URL;
    if (backupMongoUri) {
      console.log('[Backup] Connecting to secondary MongoDB cluster for replication...');
      secondaryConn = await mongoose.createConnection(backupMongoUri).asPromise();
      console.log(`[Backup] Connected to secondary MongoDB (${secondaryConn.name})`);
    } else {
      console.warn('[Backup] No BACKUP_DATABASE_URL configured. Secondary replication skipped.');
    }

    for (const collName of collectionsToBackup) {
      if (collName === 'backuplogs') continue;

      try {
        const primaryColl = primaryDb.collection(collName);
        let secondaryColl: any = null;

        if (secondaryConn && secondaryConn.db) {
          secondaryColl = secondaryConn.db.collection(collName);
          // 1. Wipe existing secondary collection to guarantee fresh replica
          await secondaryColl.deleteMany({});

          // 2. Replicate all indexes from primary (excluding default _id_)
          try {
            const rawIndexes = await primaryColl.indexes();
            for (const idx of rawIndexes) {
              if (idx.name === '_id_') continue;
              const { key, name, unique, sparse, expireAfterSeconds } = idx;
              const options: any = { name };
              if (unique) options.unique = true;
              if (sparse) options.sparse = true;
              if (expireAfterSeconds !== undefined) options.expireAfterSeconds = expireAfterSeconds;
              await secondaryColl.createIndex(key, options).catch(() => {});
            }
          } catch (idxErr: any) {
            console.warn(`[Backup] Index sync note for ${collName}:`, idxErr.message);
          }
        }

        const cursor = primaryColl.find({});
        let chunk: any[] = [];

        if (!isFirstModel) gzip.write(',\n');
        isFirstModel = false;

        gzip.write(`"${collName}": [\n`);
        let isFirstDoc = true;

        for await (const doc of cursor) {
          // Write to local JSON stream
          if (!isFirstDoc) gzip.write(',\n');
          isFirstDoc = false;
          gzip.write(JSON.stringify(doc));

          // Batch chunk for secondary replication
          if (secondaryColl) {
            chunk.push(doc);
            if (chunk.length >= 1000) {
              await secondaryColl.insertMany(chunk, { ordered: false });
              chunk = [];
            }
          }
        }

        gzip.write('\n]');

        // Flush remaining chunk
        if (secondaryColl && chunk.length > 0) {
          await secondaryColl.insertMany(chunk, { ordered: false });
        }

        if (secondaryColl) {
          const replicatedCount = await secondaryColl.countDocuments();
          console.log(
            `[Backup] Replicated ${replicatedCount} records to secondary DB for collection ${collName}`
          );
        }
      } catch (err: any) {
        console.error(`[Backup] Stream/Replication failed for collection ${collName}:`, err.message);
      }
    }

    // End JSON object
    gzip.write('\n}\n');

    // Wait for file stream to finish writing
    await new Promise((resolve, reject) => {
      gzip.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log(`[Backup] Local compressed backup saved: ${backupFilePath}`);

    if (secondaryConn) {
      await secondaryConn.close();
      console.log('[Backup] Secondary DB replication completed successfully!');
    }

    // Clean up older local backups (> 7 days)
    try {
      const files = fs.readdirSync(backupsDir);
      const backupFiles = files.filter(
        (f) => f.startsWith('backup-') && f.endsWith('.json.gz')
      );
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      for (const file of backupFiles) {
        const filePath = path.join(backupsDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtime < oneWeekAgo) {
          fs.unlinkSync(filePath);
          console.log(`[Backup] Deleted old local backup (>1 week): ${file}`);
        }
      }
    } catch (cleanupErr) {
      console.warn('[Backup] Error cleaning up old backup files:', cleanupErr);
    }

    // Save success log
    await BackupLogModel.create({
      status: 'success',
      backupFile: backupFilePath,
      recordsDetail,
      triggerType,
      message: 'Database backup and replication completed successfully.',
      timestamp: new Date(),
    });

    return {
      success: true,
      timestamp,
      backupFile: backupFilePath,
      recordsDetail,
      message: 'Database backup and replication completed successfully.',
    };
  } catch (error: any) {
    console.error('[Backup] Backup process failed!', error);

    try {
      await BackupLogModel.create({
        status: 'failed',
        triggerType,
        message: error.message || String(error),
        timestamp: new Date(),
      });
    } catch (logErr) {
      console.error('[Backup] Failed to write backup log to database:', logErr);
    }

    throw error;
  }
};

export const initBackupCron = () => {
  // Daily backup at 3:00 AM UTC
  const schedule = '0 3 * * *';

  cron.schedule(
    schedule,
    async () => {
      try {
        console.log('[Backup Cron] Triggering scheduled database backup...');
        await runBackup('scheduled');
      } catch (e) {
        console.error('[Backup Cron] Scheduled backup encountered an error:', e);
      }
    },
    {
      timezone: 'UTC',
    }
  );

  console.log('⏰ Database backup cron scheduled (Daily at 3:00 AM UTC)');
};
