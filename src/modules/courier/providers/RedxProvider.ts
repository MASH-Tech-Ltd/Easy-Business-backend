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
      // 2. Prepare payload
      const payload = {
        customer_name: order.customerName,
        customer_phone: order.customerPhone,
        delivery_area: order.shippingAddress,
        delivery_area_id: 1, // Example ID, real one should be fetched from area API
        customer_address: order.shippingAddress,
        merchant_invoice_id: order.orderId,
        cash_collection_amount: order.paymentStatus === 'unpaid' ? order.totalPrice : 0,
        parcel_weight: 1000, // 1 kg
        instruction: order.note || '',
        value: order.totalPrice,
        pickup_store_id: this.clientId // Store ID from clientId
      };

      console.log('Sending order to REDX with payload:', payload);

      // 3. Make API request
      const response = await axios.post(`${this.baseUrl}/parcel`, payload, {
        headers: { 
          'Authorization': `Bearer ${this.apiSecret}`,
          'Content-Type': 'application/json'
        }
      });
      
      return {
        consignmentId: response.data?.tracking_id || response.data?.parcel_id,
        trackingUrl: `https://redx.com.bd/track-parcel/?trackingId=${response.data?.tracking_id || response.data?.parcel_id}`
      };
    } catch (error: any) {
      const errorMsg = typeof error?.response?.data === 'string' 
        ? error.response.data 
        : error?.response?.data?.message || 'Failed to create order on REDX';
      console.error('REDX API Error:', errorMsg);
      throw new Error(`REDX: ${errorMsg}`);
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
    const token = await this.getAccessToken();
    const response = await axios.get(`${this.baseUrl}/parcel/track/${trackingId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    // RedX returns an array of tracking updates, we take the latest one
    const trackingHistory = response.data?.tracking || [];
    const latestUpdate = trackingHistory.length > 0 ? trackingHistory[trackingHistory.length - 1] : null;
    const rawStatus = latestUpdate?.message || latestUpdate?.status || null;

    console.log(`[REDX Tracking] trackingId=${trackingId} rawStatus=${rawStatus}`, JSON.stringify(latestUpdate));

    if (!rawStatus) {
      throw new Error(`REDX returned no status for tracking ID ${trackingId}. Raw: ${JSON.stringify(response.data)}`);
    }

    return { status: rawStatus };
  }
}
