import { Schema, model } from 'mongoose';
import { ICourier } from './courier.interface';

const courierSchema = new Schema<ICourier>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    insideDhaka: { type: Number, required: true, default: 60 },
    outsideDhaka: { type: Number, required: true, default: 120 },
    provider: { type: String }, // Legacy
    clientId: { type: String }, // Legacy
    apiSecret: { type: String }, // Legacy
    autoForward: { type: Boolean, default: false }, // Legacy
    providers: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

export const Courier = model<ICourier>('Courier', courierSchema);
