import axios from 'axios';
import { IOrder } from '../../order/order.interface';

export class SteadfastProvider {
  private clientId: string;
  private apiSecret: string;
  private baseUrl = 'https://portal.packzy.com/api/v1'; // Standard steadfast API url

  constructor(clientId: string, apiSecret: string) {
    this.clientId = clientId;
    this.apiSecret = apiSecret;
  }

  async createOrder(order: IOrder): Promise<{ consignmentId: string; trackingUrl: string }> {
    try {
      // 1. Prepare payload
      const itemNames = order.items?.map(item => `${item.title} (x${item.quantity})`).join(', ') || '';
      
      const payload = {
        invoice: order.orderId,
        recipient_name: order.customerName,
        recipient_phone: order.customerPhone,
        recipient_address: order.shippingAddress,
        cod_amount: order.paymentStatus === 'unpaid' ? order.totalPrice : 0,
        note: order.note || 'None',
        // Optional fields that steadfast might accept according to their portal
        item_description: itemNames
      };

      console.log('Sending order to Steadfast with payload:', payload);

      // 2. Make API request
      const response = await axios.post(`${this.baseUrl}/create_order`, payload, {
        headers: {
          'Api-Key': this.clientId,
          'Secret-Key': this.apiSecret,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data && response.data.status === 200) {
        return {
          consignmentId: response.data.consignment.consignment_id?.toString() || response.data.consignment.tracking_code,
          trackingUrl: `https://steadfast.com.bd/tracking/${response.data.consignment.tracking_code}`
        };
      } else {
         console.error('Steadfast API Error Response:', response.data);
         throw new Error(response.data?.message || 'Failed to create order on Steadfast');
      }
    } catch (error: any) {
      const errorMsg = typeof error?.response?.data === 'string' 
        ? error.response.data 
        : error?.response?.data?.message || 'Failed to create order on Steadfast';
      console.error('Steadfast API Error:', errorMsg);
      // Prepend Steadfast to make it clear which courier had the issue
      throw new Error(`Steadfast: ${errorMsg}`);
    }
  }

  async getTrackingStatus(consignmentId: string): Promise<{ status: string }> {
    const response = await axios.get(`${this.baseUrl}/status_by_cid/${consignmentId}`, {
      headers: {
        'Api-Key': this.clientId,
        'Secret-Key': this.apiSecret
      }
    });

    const rawStatus = response.data?.delivery_status || response.data?.status || null;
    console.log(`[Steadfast Tracking] consignment=${consignmentId} rawStatus=${rawStatus}`, JSON.stringify(response.data));

    if (!rawStatus) {
      throw new Error(`Steadfast returned no status for consignment ${consignmentId}. Raw: ${JSON.stringify(response.data)}`);
    }

    return { status: rawStatus };
  }
}
