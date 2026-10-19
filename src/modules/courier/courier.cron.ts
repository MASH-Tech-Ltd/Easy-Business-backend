import cron from 'node-cron';
import { Order } from '../order/order.model';
import { Courier } from './courier.model';
import { Tenant } from '../tenant/tenant.model';
import { decryptText } from '../../utils/encryption';
import { PathaoProvider } from './providers/PathaoProvider';
import { SteadfastProvider } from './providers/SteadfastProvider';
import { RedxProvider } from './providers/RedxProvider';
import { getIO } from '../../socket';

import { Product } from '../product/product.model';

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

export interface RunCourierSyncOptions {
  tenantId?: string;
  orderId?: string;
}

// Extracted as a named function so it can be triggered manually via API or cron
export const runCourierStatusSync = async (options?: RunCourierSyncOptions): Promise<SyncResult> => {
  const startedAt = new Date();

  const details: SyncDetail[] = [];
  const skippedDetails: SkippedDetail[] = [];

  try {
    // Find active orders that have not been finalized and have a consignment ID
    const query: any = { 
      status: { $nin: ['delivered', 'cancelled'] }, 
      consignmentId: { $exists: true, $ne: null, $nin: ['', null] }
    };

    if (options?.tenantId) {
      query.tenantId = options.tenantId;
    }
    if (options?.orderId) {
      query.$or = [{ _id: options.orderId }, { orderId: options.orderId }];
    }

    const activeOrders = await Order.find(query);

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
      const tenantIdStr = order.tenantId?.toString();
      if (!tenantIdStr) return acc;
      if (!acc[tenantIdStr]) acc[tenantIdStr] = [];
      acc[tenantIdStr].push(order);
      return acc;
    }, {} as Record<string, typeof activeOrders>);

    // Pre-fetch tenant names and details for display and provider stores
    const tenantIds = Object.keys(ordersByTenant);
    const tenants = await Tenant.find({ _id: { $in: tenantIds } });
    const tenantMap: Record<string, string> = {};
    const tenantObjMap: Record<string, any> = {};
    tenants.forEach((t: any) => { 
      tenantMap[t._id.toString()] = t.name || t.slug || t._id.toString(); 
      tenantObjMap[t._id.toString()] = t;
    });

    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const [tenantId, orders] of Object.entries(ordersByTenant)) {
      const merchantName = tenantMap[tenantId] || tenantId;
      const tenantObj = tenantObjMap[tenantId];

      try {
        const courierConfig = await Courier.findOne({ tenantId });
        if (!courierConfig) {
          console.log(`[Courier Cron] Missing courier configuration for tenant ${tenantId}`);
          for (const order of orders) {
            skippedDetails.push({
              tenantId, merchantName,
              orderId: order.orderId,
              provider: order.courierProvider || 'Unknown',
              reason: 'No courier configuration found for this merchant',
              errorType: 'NO_CONFIG'
            });
            totalSkipped++;
          }
          continue;
        }

        // Cache initialized provider instances per merchant during this sync run
        const providerInstances: Record<string, any> = {};
        const providerErrors: Record<string, { reason: string; errorType: SkippedDetail['errorType'] }> = {};

        const getProviderForOrder = (orderProviderRaw?: string): {
          instance?: any;
          providerId: string;
          error?: { reason: string; errorType: SkippedDetail['errorType'] };
        } => {
          // Identify this specific order's provider, falling back to merchant's default provider
          const providerId = (orderProviderRaw || courierConfig.provider || '').toLowerCase().trim();
          if (!providerId) {
            return {
              providerId: 'Unknown',
              error: {
                reason: 'No courier provider configured for this order and no default found',
                errorType: 'NO_PROVIDER',
              },
            };
          }

          if (providerInstances[providerId]) {
            return { instance: providerInstances[providerId], providerId };
          }
          if (providerErrors[providerId]) {
            return { error: providerErrors[providerId], providerId };
          }

          // Case-insensitive lookup in courierConfig.providers
          let pConfig: any = null;
          if (courierConfig.providers) {
            const providersObj = courierConfig.providers as Record<string, any>;
            const foundKey = Object.keys(providersObj).find(
              (k) => k.toLowerCase().trim() === providerId
            );
            if (foundKey) {
              pConfig = providersObj[foundKey];
            }
          }

          // Fallback to legacy single-provider configuration if provider matches
          if (!pConfig && courierConfig.provider?.toLowerCase()?.trim() === providerId) {
            pConfig = {
              clientId: courierConfig.clientId,
              apiSecret: courierConfig.apiSecret,
              username: (courierConfig as any).username,
              password: (courierConfig as any).password,
              isActive: true,
            };
          }

          if (!pConfig || (!pConfig.clientId && !pConfig.apiSecret)) {
            const err = {
              reason: `Credentials for courier provider "${providerId}" are not configured for this merchant`,
              errorType: 'NO_CONFIG' as const,
            };
            providerErrors[providerId] = err;
            return { error: err, providerId };
          }

          let clientId = pConfig.clientId || '';
          let apiSecret = pConfig.apiSecret || '';
          try { clientId = decryptText(clientId); } catch (e) {}
          try { apiSecret = decryptText(apiSecret); } catch (e) {}

          if (!clientId || !apiSecret) {
            const err = {
              reason: `Courier credentials for "${providerId}" are empty or decryption failed`,
              errorType: 'AUTH_ERROR' as const,
            };
            providerErrors[providerId] = err;
            return { error: err, providerId };
          }

          let instance: any = null;
          if (providerId === 'pathao') {
            let pathaoUsername = '';
            let pathaoPassword = '';
            try { pathaoUsername = decryptText(pConfig.username || ''); } catch (e) { pathaoUsername = pConfig.username || ''; }
            try { pathaoPassword = decryptText(pConfig.password || ''); } catch (e) { pathaoPassword = pConfig.password || ''; }
            instance = new PathaoProvider(clientId, apiSecret, pathaoUsername, pathaoPassword);
          } else if (providerId === 'steadfast') {
            instance = new SteadfastProvider(clientId, apiSecret);
          } else if (providerId === 'redx') {
            instance = new RedxProvider(clientId, apiSecret, false, tenantObj);
          } else {
            const err = {
              reason: `Unknown or unsupported courier provider: "${providerId}"`,
              errorType: 'UNKNOWN_PROVIDER' as const,
            };
            providerErrors[providerId] = err;
            return { error: err, providerId };
          }

          providerInstances[providerId] = instance;
          return { instance, providerId };
        };

        let tenantUpdated = false;

        for (const order of orders) {
          const { instance: providerInstance, providerId, error } = getProviderForOrder(order.courierProvider);

          if (error) {
            skippedDetails.push({
              tenantId,
              merchantName,
              orderId: order.orderId,
              provider: providerId,
              reason: error.reason,
              errorType: error.errorType,
            });
            totalSkipped++;
            continue;
          }

          try {
            const trackingData = await providerInstance.getTrackingStatus(order.consignmentId);
            let newStatus: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" | "returned" | null = null;
            
            const courierStatus = (trackingData?.status || '').toLowerCase();
            
            // Comprehensive status mapping logic based on provider documentations
            if (
              courierStatus.includes('delivered') || 
              courierStatus.includes('delivery_successful') || 
              courierStatus.includes('successful') || 
              courierStatus.includes('package delivered') ||
              courierStatus === 'paid'
            ) {
              newStatus = 'delivered';
            } else if (
              courierStatus.includes('returned') || 
              courierStatus.includes('return_successful') ||
              courierStatus.includes('returned_to_merchant') ||
              courierStatus.includes('agent-returning') ||
              courierStatus.includes('return')
            ) {
              newStatus = 'returned';
            } else if (
              courierStatus.includes('cancel') || 
              courierStatus.includes('delete') ||
              courierStatus.includes('unknown') ||
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
              courierStatus.includes('picked') ||
              courierStatus.includes('in_transit') ||
              courierStatus.includes('ready-for-delivery') ||
              courierStatus.includes('delivery-in-progress') ||
              courierStatus.includes('agent-hold') ||
              courierStatus.includes('agent-area-change')
            ) {
              newStatus = 'shipped';
            }

            // Only update if we mapped a new valid status that is different from current
            if (newStatus && newStatus !== order.status) {
              console.log(`[Courier Cron] Updating order ${order.orderId} status from ${order.status} to ${newStatus} (${providerId})`);
              
              details.push({
                tenantId,
                merchantName,
                orderId: order.orderId,
                provider: providerId,
                oldStatus: order.status,
                newStatus: newStatus
              });

              const oldStatus = order.status;
              order.status = newStatus;
              if (newStatus === 'delivered' && order.paymentStatus === 'unpaid') {
                order.paymentStatus = 'paid';
              }
              await order.save();

              // If order became cancelled or returned from a confirmed/shipped state, revert stock
              if ((newStatus === 'cancelled' || newStatus === 'returned') && ['confirmed', 'shipped'].includes(oldStatus)) {
                try {
                  for (const item of (order.items || [])) {
                    if (item.productId) {
                      await Product.findByIdAndUpdate(item.productId, {
                        $inc: { salesCount: -item.quantity, stock: item.quantity },
                      });
                    }
                  }
                } catch (stockErr) {
                  console.error(`[Courier Cron] Error reverting stock for order ${order.orderId}:`, stockErr);
                }
              }

              tenantUpdated = true;
              totalUpdated++;
            } else {
              // No status change needed — still a valid skip
              skippedDetails.push({
                tenantId,
                merchantName,
                orderId: order.orderId,
                provider: providerId,
                reason: `Status unchanged (current: ${order.status}, courier: ${courierStatus})`,
                errorType: 'NO_STATUS_CHANGE'
              });
              totalSkipped++;
            }
          } catch (err: any) {
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
              tenantId,
              merchantName,
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

        if (tenantUpdated) {
          const io = getIO();
          if (io) {
            io.to(tenantId).emit('dashboard:refresh');
          }
        }
      } catch (err: any) {
        console.error(`[Courier Cron] Error processing tenant ${tenantId}:`, err.message);
        skippedDetails.push({
          tenantId,
          merchantName,
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

