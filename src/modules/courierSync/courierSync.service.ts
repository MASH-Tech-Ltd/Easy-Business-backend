import { CourierSyncReport } from './courierSync.model';
import { SyncResult } from '../courier/courier.cron';

const MAX_HISTORY_COUNT = 7;

/**
 * Saves a sync result to MongoDB and ensures only the latest 7 reports are kept.
 * Called after every manual or cron-triggered sync.
 */
const saveSyncReport = async (result: SyncResult) => {
  const report = await CourierSyncReport.create({
    synced:         result.synced,
    updated:        result.updated,
    skipped:        result.skipped,
    details:        result.details,
    skippedDetails: result.skippedDetails,
    startedAt:      new Date(result.startedAt),
    completedAt:    new Date(result.completedAt),
    durationMs:     result.durationMs,
  });

  // Keep only the latest 7 reports, delete the rest
  const count = await CourierSyncReport.countDocuments();
  if (count > MAX_HISTORY_COUNT) {
    const recordsToKeep = await CourierSyncReport.find()
      .sort({ createdAt: -1 })
      .limit(MAX_HISTORY_COUNT)
      .select('_id');
      
    const keepIds = recordsToKeep.map(doc => doc._id);
    await CourierSyncReport.deleteMany({ _id: { $nin: keepIds } });
  }

  return report;
};

/**
 * Returns the most recent sync report.
 */
const getLatestReport = async () => {
  return CourierSyncReport.findOne().sort({ createdAt: -1 }).lean();
};

/**
 * Returns paginated sync reports within TTL (newest first).
 */
const getReportHistory = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    CourierSyncReport.find()
      .select('-details -skippedDetails') // Omit heavy arrays for history list
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CourierSyncReport.countDocuments()
  ]);

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

/**
 * Returns a specific sync report by ID.
 */
const getReportById = async (id: string) => {
  return CourierSyncReport.findById(id).lean();
};

/**
 * Deletes a specific sync report by ID.
 */
const deleteReportById = async (id: string) => {
  return CourierSyncReport.findByIdAndDelete(id);
};

export const CourierSyncService = {
  saveSyncReport,
  getLatestReport,
  getReportHistory,
  getReportById,
  deleteReportById,
};
