import cron from 'node-cron';
import { Order } from '../order/order.model';
import { Courier } from './courier.model';
import { decryptText } from '../../utils/encryption';
import { PathaoProvider } from './providers/PathaoProvider';
import { SteadfastProvider } from './providers/SteadfastProvider';
import { RedxProvider } from './providers/RedxProvider';
import { getIO } from '../../socket';

// Extracted as a named function so it can be triggered manually via API
export const runCourierStatusSync = async () => {
  console.log('[Courier Cron] Starting status sync for shipped orders...');
  try {
    // Find orders that have been shipped and have a consignment ID
    const activeOrders = await Order.find({ 
      status: { $nin: ['delivered', 'cancelled'] }, 
      consignmentId: { $exists: true, $ne: null },
      courierProvider: { $exists: true, $ne: null }
    });

    if (activeOrders.length === 0) {
      console.log('[Courier Cron] No active shipped orders to track.');
      return { synced: 0, updated: 0, details: [] };
    }

    console.log(`[Courier Cron] Found ${activeOrders.length} orders to track.`);

    // Group orders by tenantId to minimize Courier Config DB calls
    const ordersByTenant = activeOrders.reduce((acc, order) => {
      const tenantIdStr = order.tenantId.toString();
      if (!acc[tenantIdStr]) acc[tenantIdStr] = [];
      acc[tenantIdStr].push(order);
      return acc;
    }, {} as Record<string, typeof activeOrders>);

    let totalUpdated = 0;
    const details: any[] = [];

    for (const [tenantId, orders] of Object.entries(ordersByTenant)) {
      try {
        const courierConfig = await Courier.findOne({ tenantId });
        if (!courierConfig) {
          console.log(`[Courier Cron] Missing courier configuration for tenant ${tenantId}`);
          continue;
        }

        // Determine active provider — prefer providers map, fall back to legacy
        const providerId = courierConfig.provider;
        if (!providerId) {
          console.log(`[Courier Cron] No provider set for tenant ${tenantId}`);
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
          // Pathao needs username + password for OAuth token generation
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
          continue;
        }

        let tenantUpdated = false;

        for (const order of orders) {
          try {
            const trackingData = await providerInstance.getTrackingStatus(order.consignmentId);
            let newStatus: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" | null = null;
            
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
              courierStatus.includes('cancel') || 
              courierStatus.includes('delivery_failed') ||
              courierStatus.includes('return_successful') ||
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
                orderId: order.orderId,
                provider: providerId,
                oldStatus: order.status,
                newStatus: newStatus
              });

              order.status = newStatus;
              await order.save();
              tenantUpdated = true;
              totalUpdated++;
            }
          } catch (err: any) {
            console.error(`[Courier Cron] Error tracking order ${order.orderId}:`, err.message);
          }
        }

        // If any orders for this tenant were updated, emit a websocket event to refresh their dashboard
        if (tenantUpdated) {
          const io = getIO();
          if (io) {
            io.to(tenantId).emit('dashboard:refresh');
          }
        }

      } catch (err: any) {
        console.error(`[Courier Cron] Error processing tenant ${tenantId}:`, err.message);
      }
    }
    
    console.log('[Courier Cron] Completed status sync.');
    return { synced: activeOrders.length, updated: totalUpdated, details };
  } catch (error: any) {
    console.error('[Courier Cron] Fatal Error during sync:', error.message);
    throw error;
  }
};

export const initCourierCron = () => {
  // Run every 30 minutes
  cron.schedule('*/30 * * * *', runCourierStatusSync);
};
