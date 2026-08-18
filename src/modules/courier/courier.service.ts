import { Courier } from './courier.model';
import { ICourier } from './courier.interface';
import { encryptText, decryptText } from '../../utils/encryption';

const getCourierChargeByTenant = async (tenantId: string): Promise<ICourier> => {
  let courier = await Courier.findOne({ tenantId });
  if (!courier) {
    // Auto-create default if not exists
    courier = await Courier.create({ tenantId, insideDhaka: 60, outsideDhaka: 120 });
  }
  return courier;
};

const updateCourierCharge = async (tenantId: string, payload: Partial<ICourier>): Promise<ICourier | null> => {
  const result = await Courier.findOneAndUpdate(
    { tenantId },
    payload,
    { new: true, upsert: true } // upsert ensures it creates if it doesn't exist during update
  );
  return result;
};

const saveCredentials = async (tenantId: string, payload: Partial<ICourier>): Promise<ICourier | null> => {
  if (payload.apiSecret) {
    payload.apiSecret = encryptText(payload.apiSecret);
  }
  
  const result = await Courier.findOneAndUpdate(
    { tenantId },
    payload,
    { new: true, upsert: true }
  );
  return result;
};

const getAllCredentials = async () => {
  const couriers = await Courier.find().populate('tenantId', 'name slug');
  
  // Decrypt the secrets before returning for SuperAdmin
  return couriers.map((c) => {
    const doc = c.toObject();
    if (doc.apiSecret) {
      doc.apiSecret = decryptText(doc.apiSecret);
    }
    return doc;
  });
};

export const CourierService = {
  getCourierChargeByTenant,
  updateCourierCharge,
  saveCredentials,
  getAllCredentials,
};
