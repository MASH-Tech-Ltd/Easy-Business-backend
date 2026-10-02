import { Schema, model } from 'mongoose';
import { ICustomer } from './customer.interface';

const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    totalOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

customerSchema.index({ tenantId: 1, createdAt: -1 });
customerSchema.index({ tenantId: 1, phone: 1 });

export const Customer = model<ICustomer>('Customer', customerSchema);
