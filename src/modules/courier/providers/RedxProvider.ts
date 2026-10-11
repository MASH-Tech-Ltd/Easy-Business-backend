import axios from "axios";
import { IOrder } from "../../order/order.interface";

export class RedxProvider {
  private clientId: string; // Merchant Pickup Store ID (if provided)
  private apiSecret: string; // REDX API Access Token (Bearer Token)
  private baseUrl = "https://openapi.redx.com.bd/v1.0.0-beta";
  private tenant?: any;

  constructor(
    clientId: string,
    apiSecret: string,
    isSandbox: boolean = false,
    tenant?: any,
  ) {
    this.clientId = (clientId || "").trim();
    this.apiSecret = (apiSecret || "").trim();
    this.tenant = tenant;
    if (
      isSandbox ||
      this.apiSecret.toLowerCase().includes("sandbox") ||
      this.clientId.toLowerCase().includes("sandbox")
    ) {
      this.baseUrl = "https://sandbox.redx.com.bd/v1.0.0-beta";
    }
  }

  private getAuthHeaders() {
    const rawToken = this.apiSecret.replace(/^Bearer\s+/i, "").trim();
    const bearerToken = `Bearer ${rawToken}`;
    return {
      "API-ACCESS-TOKEN": bearerToken,
      Authorization: bearerToken,
      "Content-Type": "application/json",
    };
  }

  /**
   * Dynamically fetch all pickup stores registered under this REDX account
   */
  async getPickupStores(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/pickup/stores`, {
        headers: this.getAuthHeaders(),
      });
      return response.data?.pickup_stores || [];
    } catch (err: any) {
      console.warn(
        "[REDX Provider] Could not fetch pickup stores:",
        err?.response?.data || err?.message,
      );
      return [];
    }
  }

  /**
   * Dynamically resolves a valid pickup store ID for the parcel.
   * If merchant provided a valid numeric store ID, verifies or uses it.
   * If not provided, dynamically grabs the merchant's first active pickup store from REDX.
   * If none exists on REDX, creates one dynamically using the merchant's business information.
   */
  async resolvePickupStoreId(): Promise<number> {
    const headers = this.getAuthHeaders();
    const stores = await this.getPickupStores();

    if (stores && stores.length > 0) {
      const parsedProvided = Number(this.clientId);
      if (!isNaN(parsedProvided) && parsedProvided > 0) {
        const found = stores.find((s: any) => Number(s.id) === parsedProvided);
        if (found) {
          console.log(
            `[REDX Provider] Using configured pickup store ID: ${found.id} (${found.name})`,
          );
          return Number(found.id);
        }
      }
      console.log(
        `[REDX Provider] Using first available pickup store from REDX: ${stores[0].id} (${stores[0].name})`,
      );
      return Number(stores[0].id);
    }

    // If no pickup store exists yet on REDX, create one automatically
    try {
      const storeName = this.tenant?.name || "Main Store";
      const storePhone =
        this.tenant?.contactPhone ||
        this.tenant?.settings?.phone ||
        "01700000000";
      const storeAddress =
        this.tenant?.contactAddress ||
        this.tenant?.settings?.address ||
        "Dhaka, Bangladesh";

      console.log(
        `[REDX Provider] No pickup stores found. Creating pickup store for "${storeName}"...`,
      );
      const createRes = await axios.post(
        `${this.baseUrl}/pickup/store`,
        {
          name: storeName,
          phone: storePhone.replace(/[^\d+]/g, ""),
          address: storeAddress,
          area_id: 1, // Default area for Dhaka
        },
        { headers },
      );

      const newId = createRes.data?.id;
      if (newId) {
        console.log(
          `[REDX Provider] Successfully created new pickup store ID: ${newId}`,
        );
        return Number(newId);
      }
    } catch (createErr: any) {
      console.error(
        "[REDX Provider] Failed to auto-create pickup store:",
        createErr?.response?.data || createErr?.message,
      );
    }

    // If clientId was provided as a number, fallback to it
    const fallbackId = Number(this.clientId);
    if (!isNaN(fallbackId) && fallbackId > 0) {
      return fallbackId;
    }

    throw new Error(
      "REDX Pickup Store not found. Please create a pickup store in your REDX merchant panel or configure your Store ID.",
    );
  }

  /**
   * In-memory cache for REDX areas to reduce redundant API calls
   */
  private static areasCache = new Map<string, { data: any[]; timestamp: number }>();
  private static CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

  private async fetchAreas(queryParam: string = ''): Promise<any[]> {
    const cacheKey = queryParam || 'all';
    const cached = RedxProvider.areasCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < RedxProvider.CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const headers = this.getAuthHeaders();
      const url = queryParam ? `${this.baseUrl}/areas?${queryParam}` : `${this.baseUrl}/areas`;
      const res = await axios.get(url, { headers });
      const areas = res.data?.areas || [];
      if (Array.isArray(areas) && areas.length > 0) {
        RedxProvider.areasCache.set(cacheKey, { data: areas, timestamp: Date.now() });
      }
      return areas;
    } catch (err: any) {
      console.warn(`[REDX Provider] Could not fetch areas (${queryParam || 'all'}):`, err?.response?.data || err?.message);
      return [];
    }
  }

  /**
   * Dynamically query delivery areas from REDX based on district and sub-district (upazila/thana).
   * Parses the trailing comma-separated parts of shippingAddress:
   * (e.g. "${address}, ${upazila}, ${district}, ${division}" -> "tongi, gazipur, Shariatpur Sadar, Shariatpur, Dhaka")
   */
  async resolveDeliveryArea(
    shippingAddress: string,
  ): Promise<{ areaId: number; areaName: string }> {
    const rawAddress = (shippingAddress || '').trim();
    if (!rawAddress) {
      return { areaId: 1, areaName: 'Dhaka' };
    }

    const cleanAddress = rawAddress.toLowerCase();
    const parts = rawAddress
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    // Known Bangladesh divisions
    const divisions = new Set([
      'dhaka',
      'chattogram',
      'chittagong',
      'rajshahi',
      'khulna',
      'barishal',
      'barisal',
      'sylhet',
      'rangpur',
      'mymensingh',
    ]);

    // Parse division, district, and sub-district from trailing values
    let division = '';
    let district = '';
    let subDistrict = '';

    if (parts.length >= 3) {
      const last = (parts[parts.length - 1] || '').toLowerCase();
      if (divisions.has(last)) {
        division = parts[parts.length - 1] || '';
        district = parts[parts.length - 2] || '';
        subDistrict = parts[parts.length - 3] || '';
      } else {
        district = parts[parts.length - 1] || '';
        subDistrict = parts[parts.length - 2] || '';
      }
    } else if (parts.length === 2) {
      const last = (parts[1] || '').toLowerCase();
      if (divisions.has(last)) {
        division = parts[1] || '';
        district = parts[0] || '';
        subDistrict = parts[0] || '';
      } else {
        district = parts[1] || '';
        subDistrict = parts[0] || '';
      }
    } else if (parts.length === 1) {
      subDistrict = parts[0] || '';
      district = parts[0] || '';
    }

    console.log(`[REDX Provider] Parsed address -> District: "${district}", Sub-District: "${subDistrict}", Division: "${division}"`);

    const normalize = (text: string) =>
      (text || '')
        .toLowerCase()
        .replace(/[()\-_\/,\.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Helper to find best area match in a list of REDX areas
    const findMatchingArea = (areasList: any[]): any | null => {
      if (!areasList || areasList.length === 0) return null;

      const normSub = normalize(subDistrict);
      const subWords = normSub.split(' ').filter((w) => w.length > 2);

      // 1. Exact match on sub-district
      if (normSub) {
        const exact = areasList.find((a: any) => normalize(a.name) === normSub);
        if (exact) return exact;
      }

      // 2. Contains match on sub-district
      if (normSub) {
        const contains = areasList.find((a: any) => {
          const aNorm = normalize(a.name);
          return aNorm.includes(normSub) || normSub.includes(aNorm);
        });
        if (contains) return contains;
      }

      // 3. Multi-word match on sub-district (e.g. "Shariatpur Sadar")
      if (subWords.length > 1) {
        const allWords = areasList.find((a: any) => {
          const aNorm = normalize(a.name);
          return subWords.every((word) => aNorm.includes(word));
        });
        if (allWords) return allWords;
      }

      // 4. Match against other parts of the address (from right to left)
      for (let i = parts.length - 1; i >= 0; i--) {
        const seg = normalize(parts[i] || '');
        if (!seg || seg === normalize(division)) continue;
        const segMatch = areasList.find((a: any) => {
          const aNorm = normalize(a.name);
          return aNorm === seg || aNorm.includes(seg) || seg.includes(aNorm);
        });
        if (segMatch) return segMatch;
      }

      // 5. Match any area name occurring anywhere in the raw address
      const addressMatch = areasList.find((a: any) => {
        const aNorm = normalize(a.name);
        return aNorm.length >= 3 && cleanAddress.includes(aNorm);
      });
      if (addressMatch) return addressMatch;

      return null;
    };

    try {
      let areas: any[] = [];

      // Step 1: Query REDX areas by district name if district is detected
      if (district) {
        areas = await this.fetchAreas(`district_name=${encodeURIComponent(district)}`);
      }

      // Step 2: If district query returned nothing, try querying by sub-district name
      if (areas.length === 0 && subDistrict && subDistrict !== district) {
        areas = await this.fetchAreas(`district_name=${encodeURIComponent(subDistrict)}`);
      }

      // Step 3: Check for postal code in address (e.g. 1206, 1207, 8000)
      const postCodeMatch = rawAddress.match(/\b\d{4}\b/);
      if (areas.length === 0 && postCodeMatch) {
        areas = await this.fetchAreas(`post_code=${postCodeMatch[0]}`);
      }

      // If we found areas for this district, search for the best sub-district match
      if (areas.length > 0) {
        const match = findMatchingArea(areas);
        if (match) {
          console.log(`[REDX Provider] Dynamically resolved area: "${match.name}" (ID: ${match.id})`);
          return { areaId: Number(match.id), areaName: match.name };
        }

        // If no specific sub-district matched, check if an area contains "Sadar" or fallback to first area
        const sadarFallback = areas.find((a: any) => normalize(a.name).includes('sadar'));
        const fallback = sadarFallback || areas[0];
        console.log(`[REDX Provider] Fallback to district area: "${fallback.name}" (ID: ${fallback.id})`);
        return { areaId: Number(fallback.id), areaName: fallback.name };
      }

      // Step 4: If no district-specific areas found, query all areas from REDX
      console.log('[REDX Provider] Fetching all areas from REDX for global resolution...');
      const allAreas = await this.fetchAreas();
      if (allAreas.length > 0) {
        const globalMatch = findMatchingArea(allAreas);
        if (globalMatch) {
          console.log(`[REDX Provider] Globally resolved area: "${globalMatch.name}" (ID: ${globalMatch.id})`);
          return { areaId: Number(globalMatch.id), areaName: globalMatch.name };
        }
      }
    } catch (err: any) {
      console.warn('[REDX Provider] Error during dynamic area resolution:', err?.response?.data || err?.message);
    }

    // Default fallback
    console.warn(`[REDX Provider] Could not resolve area for "${rawAddress}". Falling back to default Area ID: 1`);
    return { areaId: 1, areaName: rawAddress || 'Dhaka' };
  }

  async createOrder(
    order: IOrder,
  ): Promise<{ consignmentId: string; trackingUrl: string }> {
    try {
      const headers = this.getAuthHeaders();

      // 1. Dynamically resolve pickup store
      const pickupStoreId = await this.resolvePickupStoreId();

      // 2. Dynamically resolve delivery area
      const { areaId, areaName } = await this.resolveDeliveryArea(
        order.shippingAddress,
      );

      // 3. Dynamically calculate parcel weight (in grams)
      const totalQty = (order.items || []).reduce(
        (sum: number, it: any) => sum + (Number(it.quantity) || 1),
        0,
      );
      const dynamicWeight = Math.max(500, totalQty * 250);

      // 4. Dynamically prepare parcel item details
      const items =
        order.items && order.items.length > 0
          ? order.items.map((item: any) => ({
              name: item.title || "Product Item",
              category: "General",
              value: Number(item.price) || 0,
            }))
          : [
              {
                name: "General Item",
                category: "General",
                value: Number(order.totalPrice) || 0,
              },
            ];

      // 5. Clean customer phone number
      let cleanPhone = String(order.customerPhone || "")
        .replace(/[^\d+]/g, "")
        .trim();
      if (cleanPhone.startsWith("+880")) cleanPhone = cleanPhone.slice(1);
      if (cleanPhone.startsWith("880")) cleanPhone = cleanPhone.slice(2);
      if (!cleanPhone.startsWith("01") && cleanPhone.length === 10)
        cleanPhone = `0${cleanPhone}`;

      // 6. Cash collection amount: total price if unpaid, 0 if paid
      const cashAmount =
        order.paymentStatus === "unpaid" ? String(order.totalPrice || 0) : "0";

      const payload = {
        customer_name: order.customerName || "Customer",
        customer_phone: cleanPhone,
        delivery_area: areaName,
        delivery_area_id: areaId,
        customer_address: order.shippingAddress || "Bangladesh",
        merchant_invoice_id: order.orderId,
        cash_collection_amount: cashAmount,
        parcel_weight: dynamicWeight,
        instruction: order.note || "",
        value: Number(order.totalPrice) || 0,
        is_closed_box: false,
        pickup_store_id: pickupStoreId,
        parcel_details_json: items,
      };
      console.log(
        "[REDX Provider] Sending order to REDX:",
        JSON.stringify(payload),
      );

      const response = await axios.post(`${this.baseUrl}/parcel`, payload, {
        headers,
      });

      const trackingId = response.data?.tracking_id || response.data?.parcel_id;
      if (!trackingId) {
        throw new Error(
          `REDX responded without a tracking_id: ${JSON.stringify(response.data)}`,
        );
      }

      return {
        consignmentId: trackingId,
        trackingUrl: `https://redx.com.bd/track-parcel/?trackingId=${trackingId}`,
      };
    } catch (error: any) {
      const errorMsg =
        error?.response?.data?.message ||
        (typeof error?.response?.data === "string"
          ? error.response.data
          : null) ||
        error?.message ||
        "Failed to create order on REDX";
      console.error(
        "[REDX Provider] API Error:",
        errorMsg,
        error?.response?.data,
      );
      throw new Error(`REDX: ${errorMsg}`);
    }
  }

  async getTrackingStatus(trackingId: string): Promise<{ status: string }> {
    const headers = this.getAuthHeaders();

    // 1. First attempt /parcel/info for machine-readable parcel.status (e.g. ready-for-delivery, delivered, returned)
    try {
      const infoRes = await axios.get(
        `${this.baseUrl}/parcel/info/${trackingId}`,
        { headers },
      );
      const parcelStatus = infoRes.data?.parcel?.status;
      if (parcelStatus) {
        console.log(
          `[REDX Tracking Info] trackingId=${trackingId} status=${parcelStatus}`,
        );
        return { status: parcelStatus };
      }
    } catch (e: any) {
      console.log(`[REDX Tracking Info fallback] ${e?.message}`);
    }

    // 2. Query /parcel/track
    const trackRes = await axios.get(
      `${this.baseUrl}/parcel/track/${trackingId}`,
      { headers },
    );
    const trackingHistory = trackRes.data?.tracking || [];
    const latestUpdate =
      trackingHistory.length > 0
        ? trackingHistory[trackingHistory.length - 1]
        : null;
    const rawStatus =
      latestUpdate?.message_en ||
      latestUpdate?.message ||
      latestUpdate?.status ||
      null;

    console.log(
      `[REDX Tracking Track] trackingId=${trackingId} rawStatus=${rawStatus}`,
    );

    if (!rawStatus) {
      throw new Error(
        `REDX returned no status for tracking ID ${trackingId}. Raw: ${JSON.stringify(trackRes.data)}`,
      );
    }

    return { status: rawStatus };
  }
}
