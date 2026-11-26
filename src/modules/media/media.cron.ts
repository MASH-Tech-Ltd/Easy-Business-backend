import cron from 'node-cron';
import { MediaService } from './media.service';
import { syncCloudflareMediaAnalytics } from './mediaAnalytics.service';

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

  // Sync per-merchant Cloudflare R2 read/bandwidth metrics hourly when MEDIA_ANALYTICS_SYNC=true
  cron.schedule('0 * * * *', async () => {
    try {
      const res = await syncCloudflareMediaAnalytics();
      if (res.synced && res.merchantsUpdated > 0) {
        console.log(`[media:cron] Synced Cloudflare read metrics for ${res.merchantsUpdated} merchants.`);
      }
    } catch (error) {
      console.error('[media:cron] Error syncing Cloudflare media analytics:', error);
    }
  });
};
