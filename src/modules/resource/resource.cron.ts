import cron from 'node-cron';
import { ResourceAddonService } from './resource.addon.service';
import { runCloudflareIngestCycle } from './resource.ingest.service';
import { MerchantResourceUsage } from './resource.model';
import { getResourceSettings } from './resource.settings';

let ingestRunning = false;

export const initResourceCron = (): void => {
  // Incremental Cloudflare ingestion. Cheap no-op unless enabled in Global Settings; windows are
  // checkpointed + leased in MongoDB, so overlapping/duplicate runs (even multi-process) are safe.
  cron.schedule('*/5 * * * *', async () => {
    if (ingestRunning) return;
    ingestRunning = true;
    try {
      const r = await runCloudflareIngestCycle();
      if (r.ran && r.windows > 0) console.log(`[resource:cron] ingested ${r.windows} window(s)`);
    } catch (e) {
      console.error('[resource:cron] ingest error', e);
    } finally {
      ingestRunning = false;
    }
  });

  // Add-on expiry + expiry warnings
  cron.schedule('10 * * * *', async () => {
    try {
      const r = await ResourceAddonService.runExpirySweep();
      if (r.expired || r.warned) console.log(`[resource:cron] add-ons expired=${r.expired} warned=${r.warned}`);
    } catch (e) {
      console.error('[resource:cron] expiry sweep error', e);
    }
  });

  // Historical retention (admin-configurable)
  cron.schedule('30 3 * * *', async () => {
    try {
      const s = await getResourceSettings();
      const cutoff = new Date();
      cutoff.setUTCMonth(cutoff.getUTCMonth() - s.analytics.retentionMonths);
      const key = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}`;
      await MerchantResourceUsage.deleteMany({ period: { $lt: key } });
    } catch (e) {
      console.error('[resource:cron] retention error', e);
    }
  });
};
