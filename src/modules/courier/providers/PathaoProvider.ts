import axios from 'axios';
import { IOrder } from '../../order/order.interface';

export class PathaoProvider {
  private clientId: string;
  private apiSecret: string;
  private username: string;
  private password: string;
  private baseUrl = 'https://api-hermes.pathao.com/aladdin/api/v1'; // Production

  constructor(clientId: string, apiSecret: string, username?: string, password?: string) {
    this.clientId = clientId;
    this.apiSecret = apiSecret;
    this.username = username || '';
    this.password = password || '';
  }

  async createOrder(order: IOrder): Promise<{ consignmentId: string; trackingUrl: string }> {
    try {
      // Fetch access token using the merchant's credentials
      const accessToken = await this.getAccessToken();
      
      // Fetch the user's stores to dynamically get the store_id
      let storeId = Number(this.clientId);
      if (isNaN(storeId)) {
        const storeResponse = await axios.get(`${this.baseUrl}/stores`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        const stores = storeResponse.data?.data?.data || storeResponse.data?.data;
        if (stores && stores.length > 0) {
          storeId = stores[0].store_id;
        } else {
          throw new Error('Pathao: No stores found for this account.');
        }
      }

      // 2. Prepare payload
      const payload = {
        store_id: storeId,
        merchant_order_id: order.orderId,
        recipient_name: order.customerName,
        recipient_phone: order.customerPhone,
        recipient_address: order.shippingAddress,
        delivery_type: 48, // Standard delivery
        item_type: 2, // Parcel
        item_quantity: order.items.reduce((acc, item) => acc + item.quantity, 0),
        item_weight: '0.5', // default weight
        amount_to_collect: order.paymentStatus === 'unpaid' ? order.totalPrice : 0,
      };

      // 3. Make API request
      const response = await axios.post(`${this.baseUrl}/orders`, payload, {
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      return {
        consignmentId: response.data?.data?.consignment_id || response.data?.consignment_id,
        trackingUrl: `https://pathao.com/tracking?consignment=${response.data?.data?.consignment_id || response.data?.consignment_id}`
      };
    } catch (error: any) {
      let errorMsg = 'Failed to create order on Pathao';
      
      if (error?.response?.data) {
        if (typeof error.response.data === 'string') {
          errorMsg = error.response.data;
        } else if (error.response.data.errors) {
          const detailedErrors = Object.entries(error.response.data.errors)
            .map(([field, messages]) => `${field}: ${(messages as string[]).join(', ')}`)
            .join(' | ');
          errorMsg = `${error.response.data.message || 'Validation Error'} - ${detailedErrors}`;
        } else {
          errorMsg = error.response.data.message || 'Failed to create order on Pathao';
        }
      }
      
      console.error('Pathao API Error:', JSON.stringify(error?.response?.data || error.message));
      throw new Error(`Pathao: ${errorMsg}`);
    }
  }

  private async getAccessToken() {
    // If the merchant provided a long personal access token, use it directly
    if (this.apiSecret && this.apiSecret.length > 100) {
      return this.apiSecret;
    }

    // Pathao OAuth2 — body must be JSON (not form-encoded), per official API docs
    const requestBody = {
      client_id: this.clientId,
      client_secret: this.apiSecret,
      username: this.username,
      password: this.password,
      grant_type: 'password'
    };

    const response = await axios.post(`${this.baseUrl}/issue-token`, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    return response.data.access_token;
  }

  async getTrackingStatus(consignmentId: string): Promise<{ status: string }> {
    try {
      const accessToken = await this.getAccessToken();

      const response = await axios.get(`${this.baseUrl}/orders/${consignmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return { status: response.data.data?.order_status || 'unknown' };
    } catch (error) {
      console.error('Pathao Tracking API Error:', error);
      return { status: 'unknown' };
    }
  }
}
