import { Schema, model } from 'mongoose';
import { IFraudCheck } from './fraudCheck.interface';

const fraudCheckSchema = new Schema<IFraudCheck>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    customerPhone: { type: String, required: true },
    customerName: { type: String, required: true },
    status: { type: String, enum: ['safe', 'suspicious', 'fraud'], required: true },
    score: { type: Number, required: true },
    details: { type: String },
    checkedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// Index for quick lookup by phone number across the platform
fraudCheckSchema.index({ customerPhone: 1 });

export const FraudCheck = model<IFraudCheck>('FraudCheck', fraudCheckSchema);
