import { Courier } from './courier.model';
import { ICourier } from './courier.interface';
import { encryptText, decryptText } from '../../utils/encryption';
import { Tenant } from '../tenant/tenant.model';
import CustomError from '../../helpers/CustomError';

const getCourierChargeByTenant = async (tenantId: string): Promise<ICourier> => {
  let courier = await Courier.findOne({ tenantId });
  if (!courier) {
    // SECURITY FIX: Validate tenant exists before auto-creating a courier record.
    // Previously any random tenantId from the URL would create a DB document.
    const tenantExists = await Tenant.exists({ _id: tenantId, status: 'active' });
    if (!tenantExists) {
      throw new CustomError(404, 'Tenant not found');
    }
    courier = await Courier.findOneAndUpdate(
      { tenantId },
      { $setOnInsert: { tenantId, insideDhaka: 60, outsideDhaka: 120 } },
      { upsert: true, new: true }
    );
  }
  
  if (courier && courier.apiSecret) {
    const doc = courier.toObject();
    try {
      const decrypted = decryptText(doc.apiSecret as string);
      const visibleCount = 6;
      if (decrypted.length > visibleCount) {
        doc.apiSecret = '*'.repeat(16) + decrypted.slice(-visibleCount);
      } else {
        doc.apiSecret = '*'.repeat(16);
      }
    } catch (e) {
      doc.apiSecret = '*'.repeat(16);
    }
    return doc as ICourier;
  }
  
  return courier as ICourier;
};

const updateCourierCharge = async (tenantId: string, payload: Partial<ICourier>): Promise<ICourier | null> => {
  const result = await Courier.findOneAndUpdate(
    { tenantId },
    { $set: payload },
    { new: true, upsert: true } // upsert ensures it creates if it doesn't exist during update
  );
  return result;
};

const saveCredentials = async (tenantId: string, payload: Partial<ICourier>): Promise<ICourier | null> => {
  if (payload.apiSecret && !payload.apiSecret.includes('***')) {
    payload.apiSecret = encryptText(payload.apiSecret);
  } else {
    // Do not overwrite existing secret if blank or masked
    delete payload.apiSecret;
  }
  
  const result = await Courier.findOneAndUpdate(
    { tenantId },
    { $set: payload },
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
