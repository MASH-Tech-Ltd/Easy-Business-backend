import axios from 'axios';
import { IOrder } from '../../order/order.interface';

export class RedxProvider {
  private clientId: string;
  private apiSecret: string;
  private baseUrl = 'https://openapi.redx.com.bd/v1.0.0'; // Sandbox or production URL

  constructor(clientId: string, apiSecret: string) {
    this.clientId = clientId;
    this.apiSecret = apiSecret;
  }

  async createOrder(order: IOrder): Promise<{ consignmentId: string; trackingUrl: string }> {
    try {
      // 1. Authenticate and get token
      // const token = await this.getAccessToken();

      // 2. Prepare payload
      const payload = {
        customer_name: order.customerName,
        customer_phone: order.customerPhone,
        delivery_area: order.shippingAddress,
        delivery_area_id: 1, // Example ID
        customer_address: order.shippingAddress,
        merchant_invoice_id: order.orderId,
        cash_collection_amount: order.paymentStatus === 'unpaid' ? order.totalPrice : 0,
        parcel_weight: 1000, // 1 kg
        instruction: order.note || '',
        value: order.totalPrice
      };

      console.log('Sending order to REDX with payload:', payload);

      // 3. Make API request
      // const response = await axios.post(`${this.baseUrl}/parcel`, payload, {
      //   headers: { Authorization: `Bearer ${token}` }
      // });
      
      // Mocking successful response for now
      return {
        consignmentId: `REDX-${order.orderId}-${Math.floor(Math.random() * 10000)}`,
        trackingUrl: `https://redx.com.bd/track-parcel/?trackingId=REDX-${order.orderId}`
      };
    } catch (error) {
      console.error('REDX API Error:', error);
      throw new Error('Failed to create order on REDX');
    }
  }

  private async getAccessToken() {
    // Authenticate with REDX API
    // const response = await axios.post(`https://api.redx.com.bd/v1.0.0/auth/token`, {
    //   email: this.clientId,
    //   password: this.apiSecret
    // });
    // return response.data.token;
    return 'mock_token';
  }

  async getTrackingStatus(trackingId: string): Promise<{ status: string }> {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(`${this.baseUrl}/parcel/track/${trackingId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // RedX returns an array of tracking updates, we take the latest one
      const trackingHistory = response.data?.tracking || [];
      const latestUpdate = trackingHistory.length > 0 ? trackingHistory[trackingHistory.length - 1] : null;
      return { status: latestUpdate?.message || 'unknown' };
    } catch (error) {
      console.error('REDX Tracking API Error:', error);
      return { status: 'unknown' };
    }
  }
}
