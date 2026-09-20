import axios from 'axios';
import { IOrder } from '../../order/order.interface';

export class PathaoProvider {
  private clientId: string;
  private apiSecret: string;
  private baseUrl = 'https://api.pathao.com/aladdin/api/v1'; // Sandbox or production URL

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
        store_id: this.clientId, // example
        merchant_order_id: order.orderId,
        recipient_name: order.customerName,
        recipient_phone: order.customerPhone,
        recipient_address: order.shippingAddress,
        recipient_city: 1, // Example city ID
        recipient_zone: 1, // Example zone ID
        delivery_type: 48, // Standard delivery
        item_type: 2, // Parcel
        item_quantity: order.items.reduce((acc, item) => acc + item.quantity, 0),
        item_weight: 1, // default weight
        amount_to_collect: order.paymentStatus === 'unpaid' ? order.totalPrice : 0,
      };

      console.log('Sending order to Pathao with payload:', payload);

      // 3. Make API request
      // const response = await axios.post(`${this.baseUrl}/orders`, payload, {
      //   headers: { Authorization: `Bearer ${token}` }
      // });
      
      // Mocking successful response for now
      return {
        consignmentId: `PATHAO-${order.orderId}-${Math.floor(Math.random() * 10000)}`,
        trackingUrl: `https://pathao.com/tracking?consignment=PATHAO-${order.orderId}`
      };
    } catch (error) {
      console.error('Pathao API Error:', error);
      throw new Error('Failed to create order on Pathao');
    }
  }

  private async getAccessToken() {
    // Authenticate with Pathao API
    // const response = await axios.post(`${this.baseUrl}/issue-token`, {
    //   client_id: this.clientId,
    //   client_secret: this.apiSecret,
    //   grant_type: 'client_credentials'
    // });
    // return response.data.access_token;
    return 'mock_token';
  }

  async getTrackingStatus(consignmentId: string): Promise<{ status: string }> {
    try {
      const token = await this.getAccessToken();
      // Pathao tracking endpoint usually requires the consignment ID
      const response = await axios.get(`${this.baseUrl}/orders/${consignmentId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { status: response.data.data?.order_status || 'unknown' };
    } catch (error) {
      console.error('Pathao Tracking API Error:', error);
      // For development/sandbox if credentials fail, return a simulated status
      return { status: 'unknown' };
    }
  }
}
