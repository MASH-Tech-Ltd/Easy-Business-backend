import cron from 'node-cron';
import { Order } from '../order/order.model';
import { Courier } from './courier.model';
import { decryptText } from '../../utils/encryption';
import { PathaoProvider } from './providers/PathaoProvider';
import { SteadfastProvider } from './providers/SteadfastProvider';
import { RedxProvider } from './providers/RedxProvider';
import { getIO } from '../../socket';

export const initCourierCron = () => {
  // Run every hour. For testing, you could use '*/2 * * * *' (every 2 minutes).
  cron.schedule('0 * * * *', async () => {
    console.log('[Courier Cron] Starting status sync for shipped orders...');
    try {
      // Find orders that have been shipped and have a consignment ID
      const activeOrders = await Order.find({ 
        status: 'shipped', 
        consignmentId: { $exists: true, $ne: null },
        courierProvider: { $exists: true, $ne: null }
      });

      if (activeOrders.length === 0) {
        console.log('[Courier Cron] No active shipped orders to track.');
        return;
      }

      console.log(`[Courier Cron] Found ${activeOrders.length} orders to track.`);

      // Group orders by tenantId to minimize Courier Config DB calls
      const ordersByTenant = activeOrders.reduce((acc, order) => {
        const tenantIdStr = order.tenantId.toString();
        if (!acc[tenantIdStr]) acc[tenantIdStr] = [];
        acc[tenantIdStr].push(order);
        return acc;
      }, {} as Record<string, typeof activeOrders>);

      for (const [tenantId, orders] of Object.entries(ordersByTenant)) {
        try {
          const courierConfig = await Courier.findOne({ tenantId });
          if (!courierConfig || !courierConfig.provider || !courierConfig.clientId || !courierConfig.apiSecret) {
            console.log(`[Courier Cron] Missing courier configuration for tenant ${tenantId}`);
            continue;
          }

          const providerId = courierConfig.provider;
          const clientId = courierConfig.clientId;
          const apiSecret = decryptText(courierConfig.apiSecret);

          let providerInstance: any;
          if (providerId === 'pathao') {
            providerInstance = new PathaoProvider(clientId, apiSecret);
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
                courierStatus.includes('cancelled') || 
                courierStatus.includes('delivery_failed') ||
                courierStatus.includes('return_successful') ||
                courierStatus === 'hold'
              ) {
                newStatus = 'cancelled';
              } else if (
                courierStatus.includes('partial_delivered') ||
                courierStatus.includes('delivered_approval_pending')
              ) {
                // Technically not fully delivered, but you can map it to delivered or leave as shipped
                newStatus = 'delivered';
              } else if (
                courierStatus.includes('pending') ||
                courierStatus.includes('in_review') ||
                courierStatus.includes('package created') ||
                courierStatus.includes('picked up') ||
                courierStatus.includes('in_transit')
              ) {
                // Remains shipped
                newStatus = 'shipped';
              }

              // Only update if we mapped a new valid status that is different from current
              if (newStatus && newStatus !== order.status) {
                console.log(`[Courier Cron] Updating order ${order.orderId} status from ${order.status} to ${newStatus}`);
                order.status = newStatus;
                await order.save();
                tenantUpdated = true;
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
    } catch (error: any) {
      console.error('[Courier Cron] Fatal Error during sync:', error.message);
    }
  });
};
