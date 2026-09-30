import cron from 'node-cron';
import { Order } from '../order/order.model';
import { Courier } from './courier.model';
import { Tenant } from '../tenant/tenant.model';
import { decryptText } from '../../utils/encryption';
import { PathaoProvider } from './providers/PathaoProvider';
import { SteadfastProvider } from './providers/SteadfastProvider';
import { RedxProvider } from './providers/RedxProvider';
import { getIO } from '../../socket';

export interface SyncDetail {
  tenantId: string;
  merchantName: string;
  orderId: string;
  provider: string;
  oldStatus: string;
  newStatus: string;
}

export interface SkippedDetail {
  tenantId: string;
  merchantName: string;
  orderId?: string;
  provider?: string;
  reason: string;
  errorType: 'NO_CONFIG' | 'NO_PROVIDER' | 'UNKNOWN_PROVIDER' | 'AUTH_ERROR' | 'TRACKING_ERROR' | 'NO_STATUS_CHANGE';
}

export interface SyncResult {
  synced: number;
  updated: number;
  skipped: number;
  details: SyncDetail[];
  skippedDetails: SkippedDetail[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

// Extracted as a named function so it can be triggered manually via API
export const runCourierStatusSync = async (): Promise<SyncResult> => {
  const startedAt = new Date();

  const details: SyncDetail[] = [];
  const skippedDetails: SkippedDetail[] = [];

  try {
    // Find orders that have been shipped and have a consignment ID
    const activeOrders = await Order.find({ 
      status: { $nin: ['delivered', 'cancelled'] }, 
      consignmentId: { $exists: true, $ne: null },
      courierProvider: { $exists: true, $ne: null }
    });

    if (activeOrders.length === 0) {
      const completedAt = new Date();
      return { 
        synced: 0, updated: 0, skipped: 0, details: [], skippedDetails: [],
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime()
      };
    }

    // Group orders by tenantId to minimize Courier Config DB calls
    const ordersByTenant = activeOrders.reduce((acc, order) => {
      const tenantIdStr = order.tenantId.toString();
      if (!acc[tenantIdStr]) acc[tenantIdStr] = [];
      acc[tenantIdStr].push(order);
      return acc;
    }, {} as Record<string, typeof activeOrders>);

    // Pre-fetch tenant names for display
    const tenantIds = Object.keys(ordersByTenant);
    const tenants = await Tenant.find({ _id: { $in: tenantIds } }).select('_id name slug');
    const tenantMap: Record<string, string> = {};
    tenants.forEach((t: any) => { tenantMap[t._id.toString()] = t.name || t.slug || t._id.toString(); });

    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const [tenantId, orders] of Object.entries(ordersByTenant)) {
      const merchantName = tenantMap[tenantId] || tenantId;

      try {
        const courierConfig = await Courier.findOne({ tenantId });
        if (!courierConfig) {
          console.log(`[Courier Cron] Missing courier configuration for tenant ${tenantId}`);
          for (const order of orders) {
            skippedDetails.push({
              tenantId, merchantName,
              orderId: order.orderId,
              reason: 'No courier configuration found for this merchant',
              errorType: 'NO_CONFIG'
            });
            totalSkipped++;
          }
          continue;
        }

        // Determine active provider — prefer providers map, fall back to legacy
        const providerId = courierConfig.provider;
        if (!providerId) {
          console.log(`[Courier Cron] No provider set for tenant ${tenantId}`);
          for (const order of orders) {
            skippedDetails.push({
              tenantId, merchantName,
              orderId: order.orderId,
              reason: 'No active courier provider configured for this merchant',
              errorType: 'NO_PROVIDER'
            });
            totalSkipped++;
          }
          continue;
        }

        // Read credentials from providers map (preferred) or legacy fields
        const pConfig: any = (courierConfig.providers as Record<string, any>)?.[providerId] || {
          clientId: courierConfig.clientId,
          apiSecret: courierConfig.apiSecret,
        };

        let clientId = pConfig.clientId || '';
        let apiSecret = pConfig.apiSecret || '';
        try { clientId = decryptText(clientId); } catch (e) {}
        try { apiSecret = decryptText(apiSecret); } catch (e) {}

        let providerInstance: any;
        if (providerId === 'pathao') {
          let pathaoUsername = '';
          let pathaoPassword = '';
          try { pathaoUsername = decryptText(pConfig.username || ''); } catch (e) { pathaoUsername = pConfig.username || ''; }
          try { pathaoPassword = decryptText(pConfig.password || ''); } catch (e) { pathaoPassword = pConfig.password || ''; }
          providerInstance = new PathaoProvider(clientId, apiSecret, pathaoUsername, pathaoPassword);
        } else if (providerId === 'steadfast') {
          providerInstance = new SteadfastProvider(clientId, apiSecret);
        } else if (providerId === 'redx') {
          providerInstance = new RedxProvider(clientId, apiSecret);
        }

        if (!providerInstance) {
          console.log(`[Courier Cron] Unknown provider ${providerId} for tenant ${tenantId}`);
          for (const order of orders) {
            skippedDetails.push({
              tenantId, merchantName,
              orderId: order.orderId,
              provider: providerId,
              reason: `Unknown or unsupported courier provider: "${providerId}"`,
              errorType: 'UNKNOWN_PROVIDER'
            });
            totalSkipped++;
          }
          continue;
        }

        let tenantUpdated = false;

        for (const order of orders) {
          try {
            const trackingData = await providerInstance.getTrackingStatus(order.consignmentId);
            let newStatus: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" | "returned" | null = null;
            
            const courierStatus = trackingData.status.toLowerCase();
            
            // Comprehensive status mapping logic based on provider documentations
            if (
              courierStatus.includes('delivered') || 
              courierStatus.includes('delivery_successful') || 
              courierStatus.includes('successful') || 
              courierStatus.includes('package delivered')
            ) {
              newStatus = 'delivered';
            } else if (
              courierStatus.includes('returned') || 
              courierStatus.includes('return_successful') ||
              courierStatus.includes('returned_to_merchant') ||
              courierStatus.includes('return')
            ) {
              newStatus = 'returned';
            } else if (
              courierStatus.includes('cancel') || 
              courierStatus.includes('delivery_failed') ||
              courierStatus === 'hold'
            ) {
              newStatus = 'cancelled';
            } else if (
              courierStatus.includes('partial_delivered') ||
              courierStatus.includes('delivered_approval_pending')
            ) {
              newStatus = 'delivered';
            } else if (
              courierStatus.includes('pending') ||
              courierStatus.includes('in_review') ||
              courierStatus.includes('package created') ||
              courierStatus.includes('picked up') ||
              courierStatus.includes('in_transit')
            ) {
              newStatus = 'shipped';
            }

            // Only update if we mapped a new valid status that is different from current
            if (newStatus && newStatus !== order.status) {
              console.log(`[Courier Cron] Updating order ${order.orderId} status from ${order.status} to ${newStatus}`);
              
              details.push({
                tenantId,
                merchantName,
                orderId: order.orderId,
                provider: providerId,
                oldStatus: order.status,
                newStatus: newStatus
              });

              order.status = newStatus;
              await order.save();
              tenantUpdated = true;
              totalUpdated++;
            } else {
              // No status change needed — still a valid skip
              skippedDetails.push({
                tenantId, merchantName,
                orderId: order.orderId,
                provider: providerId,
                reason: `Status unchanged (current: ${order.status}, courier: ${courierStatus})`,
                errorType: 'NO_STATUS_CHANGE'
              });
              totalSkipped++;
            }
          } catch (err: any) {
            // Detect auth errors
            const errMsg = err.message || '';
            const isAuthError = 
              errMsg.toLowerCase().includes('unauthorized') ||
              errMsg.toLowerCase().includes('401') ||
              errMsg.toLowerCase().includes('forbidden') ||
              errMsg.toLowerCase().includes('403') ||
              errMsg.toLowerCase().includes('invalid credentials') ||
              errMsg.toLowerCase().includes('authentication') ||
              errMsg.toLowerCase().includes('token') ||
              errMsg.toLowerCase().includes('access denied');

            skippedDetails.push({
              tenantId, merchantName,
              orderId: order.orderId,
              provider: providerId,
              reason: isAuthError
                ? `Authentication failed for ${providerId}: ${errMsg}`
                : `Tracking error: ${errMsg}`,
              errorType: isAuthError ? 'AUTH_ERROR' : 'TRACKING_ERROR'
            });
            totalSkipped++;
          }
        }

        // If any orders for this tenant were updated, emit a websocket event
        if (tenantUpdated) {
          const io = getIO();
          if (io) {
            io.to(tenantId).emit('dashboard:refresh');
          }
        }

      } catch (err: any) {
        console.error(`[Courier Cron] Error processing tenant ${tenantId}:`, err.message);
        skippedDetails.push({
          tenantId, merchantName,
          reason: `Fatal error processing merchant: ${err.message}`,
          errorType: 'AUTH_ERROR'
        });
        totalSkipped += orders.length;
      }
    }

    const completedAt = new Date();
    return { 
      synced: activeOrders.length, 
      updated: totalUpdated, 
      skipped: totalSkipped,
      details,
      skippedDetails,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime()
    };
  } catch (error: any) {
    throw error;
  }
};

export const initCourierCron = () => {
  // Run every 30 minutes — auto-save result to DB
  cron.schedule('*/30 * * * *', async () => {
    try {
      const result = await runCourierStatusSync();
      // Lazy import to avoid circular dependency issues at module init time
      const { CourierSyncService } = await import('../courierSync/courierSync.service');
      await CourierSyncService.saveSyncReport(result);
    } catch (err: any) {
    }
  });
};

