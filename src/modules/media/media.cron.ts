import cron from 'node-cron';
import { MediaService } from './media.service';

export const initMediaCron = (): void => {
  // Retry failed storage deletions every 15 minutes so transient provider errors never leave orphans
  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await MediaService.retryPendingDeletes(50);
      if (result.retried > 0) {
        console.log(
          `[media:cron] Retried ${result.retried} pending media deletions; deleted ${result.deleted}.`,
        );
      }
    } catch (error) {
      console.error('[media:cron] Error retrying pending media deletions:', error);
    }
  });
};
