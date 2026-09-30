import { Courier } from "./courier.model";
import { ICourier } from "./courier.interface";
import { encryptText, decryptText } from "../../utils/encryption";
import { Tenant } from "../tenant/tenant.model";
import { Subscription } from "../subscription/subscription.model";
import { Order } from "../order/order.model";
import { PathaoProvider } from "./providers/PathaoProvider";
import { SteadfastProvider } from "./providers/SteadfastProvider";
import { RedxProvider } from "./providers/RedxProvider";
import CustomError from "../../helpers/CustomError";
import { Addon } from "../addon/addon.model";

const getCourierChargeByTenant = async (
  tenantId: string,
): Promise<ICourier> => {
  let courier = await Courier.findOne({ tenantId });
  if (!courier) {
    const tenantExists = await Tenant.exists({
      _id: tenantId,
      status: "active",
    });
    if (!tenantExists) {
      throw new CustomError(404, "Tenant not found");
    }
    courier = await Courier.findOneAndUpdate(
      { tenantId },
      { $setOnInsert: { tenantId, insideDhaka: 60, outsideDhaka: 120 } },
      { upsert: true, returnDocument: "after" },
    );
  }

  if (courier) {
    const doc = courier.toObject();

    // Process API Secret Masking (Legacy)
    if (doc.apiSecret) {
      try {
        const decrypted = decryptText(doc.apiSecret as string);
        doc.apiSecret = "•".repeat(12) + decrypted.slice(-4);
      } catch (e) {
        doc.apiSecret = "•".repeat(16);
      }
    }

    // Process Client ID (API Key) Masking for Steadfast (Legacy)
    if (doc.clientId && doc.provider === "steadfast") {
      try {
        const decryptedClientId = decryptText(doc.clientId as string);
        doc.clientId = "•".repeat(12) + decryptedClientId.slice(-4);
      } catch (e) {
        doc.clientId = "•".repeat(16);
      }
    } else if (doc.clientId) {
      try {
        doc.clientId = decryptText(doc.clientId as string);
      } catch (e) {}
    }

    // Process all providers
    if (doc.providers) {
      for (const [key, p] of Object.entries(doc.providers) as any) {
        // Mask API Secret
        if (p.apiSecret) {
          try {
            const decrypted = decryptText(p.apiSecret);
            p.apiSecret = "•".repeat(12) + decrypted.slice(-4);
          } catch (e) {
            p.apiSecret = "•".repeat(16);
          }
        }

        // Mask Client ID for Pathao and Steadfast
        if (p.clientId) {
          try {
            const decrypted = decryptText(p.clientId);
            // If it's short, just show last 4
            p.clientId =
              "•".repeat(Math.max(12, decrypted.length - 4)) +
              decrypted.slice(-4);
          } catch (e) {
            p.clientId = "•".repeat(16);
          }
        }

        // Mask Email / Username
        if (p.username) {
          try {
            const dec = decryptText(p.username);
            const [local, domain] = dec.split("@");
            if (local && domain) {
              p.username =
                local.substring(0, 2) +
                "•".repeat(Math.max(3, local.length - 2)) +
                "@" +
                domain;
            } else {
              p.username = "•".repeat(12);
            }
          } catch (e) {
            p.username = "•".repeat(12);
          }
        }

        // Mask Password
        if (p.password) {
          try {
            const dec = decryptText(p.password);
            p.password =
              "•".repeat(Math.max(8, dec.length - 4)) + dec.slice(-4);
          } catch (e) {
            p.password = "•".repeat(12);
          }
        }
      }
    }

    return doc as ICourier;
  }

  return courier as unknown as ICourier;
};

const updateCourierCharge = async (
  tenantId: string,
  payload: Partial<ICourier>,
): Promise<ICourier | null> => {
  const result = await Courier.findOneAndUpdate(
    { tenantId },
    { $set: payload },
    { returnDocument: "after", upsert: true }, // upsert ensures it creates if it doesn't exist during update
  );
  return result;
};

const saveCredentials = async (
  tenantId: string,
  payload: any,
): Promise<ICourier | null> => {
  const {
    provider,
    clientId,
    apiSecret,
    autoForward,
    isActive = true,
    username,
    password,
  } = payload;
  const updateDoc: any = {};

  const isMasked = (val: string) => val?.includes("•") || val?.includes("***");

  if (provider) {
    if (clientId && !isMasked(clientId)) {
      const enc = encryptText(clientId.trim());
      updateDoc[`providers.${provider}.clientId`] = enc;
      updateDoc.clientId = enc; // Legacy
    }
    if (apiSecret && !isMasked(apiSecret)) {
      const enc = encryptText(apiSecret.trim());
      updateDoc[`providers.${provider}.apiSecret`] = enc;
      updateDoc.apiSecret = enc; // Legacy
    }
    // Pathao-specific: store encrypted username/password per merchant
    if (username && !isMasked(username)) {
      updateDoc[`providers.${provider}.username`] = encryptText(
        username.trim(),
      );
    }
    if (password && !isMasked(password)) {
      updateDoc[`providers.${provider}.password`] = encryptText(
        password.trim(),
      );
    }
    if (autoForward !== undefined) {
      updateDoc[`providers.${provider}.autoForward`] = autoForward;
      updateDoc.autoForward = autoForward; // Legacy
    }
    updateDoc[`providers.${provider}.isActive`] = isActive;
    if (isActive) updateDoc.provider = provider;
  }

  const result = await Courier.findOneAndUpdate(
    { tenantId },
    { $set: updateDoc },
    { returnDocument: "after", upsert: true },
  );
  return result;
};

const getAllCredentials = async () => {
  const couriers = await Courier.find().populate("tenantId", "name slug");

  // Decrypt the secrets before returning for SuperAdmin
  return couriers.map((c) => {
    const doc = c.toObject();
    if (doc.apiSecret) {
      doc.apiSecret = decryptText(doc.apiSecret);
    }
    return doc;
  });
};

const checkCourierAddonLimit = async (tenantId: string) => {
  const subscription = await Subscription.findOne({
    tenantId,
    status: "active",
  }).populate("purchasedAddons.addonId");
  if (!subscription || !subscription.purchasedAddons) {
    throw new CustomError(403, "No active add-ons found for this subscription");
  }

  const courierAddon = subscription.purchasedAddons.find(
    (pa: any) =>
      pa.addonId?.slug === "courier_automation" && pa.status === "active",
  );

  if (!courierAddon) {
    const addonInfo = await Addon.findOne({ slug: "courier_automation" });
    throw new CustomError(
      403,
      "Courier Automation add-on is not active or purchased for this subscription",
      {
        addonId: addonInfo?._id,
        addonSlug: "courier_automation",
      },
    );
  }

  if (courierAddon.used >= courierAddon.limit) {
    throw new CustomError(
      403,
      "Courier Automation limit reached. Please upgrade your add-on.",
    );
  }

  const courierConfig = await Courier.findOne({ tenantId });
  let configuredProviders: string[] = [];
  if (courierConfig?.providers) {
    configuredProviders = Object.keys(courierConfig.providers).filter(
      (k) =>
        (courierConfig.providers as any)[k]?.isActive &&
        (courierConfig.providers as any)[k]?.clientId,
    );
  } else if (courierConfig?.provider) {
    configuredProviders = [courierConfig.provider];
  }
  return { allowed: true, configuredProviders };
};

const forwardOrder = async (
  orderId: string,
  tenantId: string,
  providerId: string,
) => {
  // 1. Check add-on limits
  const { allowed } = await checkCourierAddonLimit(tenantId);

  // 2. Fetch order
  const order = await Order.findOne({ _id: orderId, tenantId });
  if (!order) {
    throw new CustomError(404, "Order not found");
  }
  if (order.consignmentId) {
    throw new CustomError(400, "Order is already forwarded to a courier");
  }

  // 3. Get Credentials
  const courierConfig = await Courier.findOne({ tenantId });

  let pConfig: any = null;
  if (
    courierConfig?.providers &&
    (courierConfig.providers as Record<string, any>)[providerId]
  ) {
    pConfig = (courierConfig.providers as Record<string, any>)[providerId];
  } else if (courierConfig?.provider === providerId) {
    pConfig = {
      clientId: courierConfig.clientId,
      apiSecret: courierConfig.apiSecret,
      isActive: true,
    };
  }

  if (!pConfig || !pConfig.isActive) {
    throw new CustomError(
      400,
      `Courier provider ${providerId} is not configured or active`,
    );
  }

  if (!pConfig.clientId || !pConfig.apiSecret) {
    throw new CustomError(
      400,
      `Courier credentials for ${providerId} are missing`,
    );
  }

  let clientId = pConfig.clientId;
  let apiSecret = pConfig.apiSecret;

  try {
    clientId = decryptText(clientId);
  } catch (e) {}
  try {
    apiSecret = decryptText(apiSecret);
  } catch (e) {}

  // 4. Create Order on Provider
  // Decrypt Pathao-specific username/password per merchant
  let pathaoUsername = "";
  let pathaoPassword = "";
  if (providerId === "pathao") {
    try {
      pathaoUsername = decryptText(pConfig.username || "");
    } catch (e) {
      pathaoUsername = pConfig.username || "";
    }
    try {
      pathaoPassword = decryptText(pConfig.password || "");
    } catch (e) {
      pathaoPassword = pConfig.password || "";
    }
  }

  let result;
  if (providerId === "pathao") {
    const provider = new PathaoProvider(
      clientId,
      apiSecret,
      pathaoUsername,
      pathaoPassword,
    );
    result = await provider.createOrder(order);
  } else if (providerId === "steadfast") {
    const provider = new SteadfastProvider(clientId, apiSecret);
    result = await provider.createOrder(order);
  } else if (providerId === "redx") {
    const provider = new RedxProvider(clientId, apiSecret);
    result = await provider.createOrder(order);
  } else {
    throw new CustomError(400, "Unsupported courier provider");
  }

  // 5. Update Order
  order.consignmentId = result.consignmentId;
  order.trackingUrl = result.trackingUrl;
  order.courierProvider = providerId;
  order.status = "shipped"; // Automatically mark as shipped? (Optional, kept original status logic unless asked)
  await order.save();

  // 6. Increment Usage
  const subscription = await Subscription.findOne({
    tenantId,
    status: "active",
  }).populate("purchasedAddons.addonId");
  if (subscription && subscription.purchasedAddons) {
    const courierAddon = subscription.purchasedAddons.find(
      (pa: any) =>
        pa.addonId?.slug === "courier_automation" && pa.status === "active",
    );
    if (courierAddon) {
      courierAddon.used += 1;
      await subscription.save();
    }
  }

  return {
    consignmentId: result.consignmentId,
    trackingUrl: result.trackingUrl,
    status: "success",
  };
};

export const CourierService = {
  getCourierChargeByTenant,
  updateCourierCharge,
  saveCredentials,
  getAllCredentials,
  checkCourierAddonLimit,
  forwardOrder,
};
