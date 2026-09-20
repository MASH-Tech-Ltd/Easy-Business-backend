import axios from 'axios';
import { IOrder } from '../../order/order.interface';

export class SteadfastProvider {
  private clientId: string;
  private apiSecret: string;
  private baseUrl = 'https://portal.steadfast.com.bd/api/v1'; // Standard steadfast API url

  constructor(clientId: string, apiSecret: string) {
    this.clientId = clientId;
    this.apiSecret = apiSecret;
  }

  async createOrder(order: IOrder): Promise<{ consignmentId: string; trackingUrl: string }> {
    try {
      // 1. Prepare payload
      const payload = {
        invoice: order.orderId,
        recipient_name: order.customerName,
        recipient_phone: order.customerPhone,
        recipient_address: order.shippingAddress,
        cod_amount: order.paymentStatus === 'unpaid' ? order.totalPrice : 0,
        note: order.note || 'None',
      };

      console.log('Sending order to Steadfast with payload:', payload);

      // 2. Make API request
      // const response = await axios.post(`${this.baseUrl}/create_order`, payload, {
      //   headers: {
      //     'Api-Key': this.clientId,
      //     'Secret-Key': this.apiSecret,
      //     'Content-Type': 'application/json'
      //   }
      // });
      
      // Mocking successful response for now
      return {
        consignmentId: `STEADFAST-${order.orderId}-${Math.floor(Math.random() * 10000)}`,
        trackingUrl: `https://steadfast.com.bd/tracking/${order.orderId}`
      };
    } catch (error) {
      console.error('Steadfast API Error:', error);
      throw new Error('Failed to create order on Steadfast');
    }
  }

  async getTrackingStatus(consignmentId: string): Promise<{ status: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}/status_by_consignment/${consignmentId}`, {
        headers: {
          'Api-Key': this.clientId,
          'Secret-Key': this.apiSecret
        }
      });
      return { status: response.data.delivery_status || 'unknown' };
    } catch (error) {
      console.error('Steadfast Tracking API Error:', error);
      return { status: 'unknown' };
    }
  }
}
