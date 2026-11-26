import { Schema, model, Document, Types } from 'mongoose';

export type SmsTriggerType = 'new_order_offline' | 'order_confirmation' | 'admin_manual';
export type SmsStatus = 'sent' | 'failed';

export interface ISmsLog extends Document {
  tenantId: Types.ObjectId | null;
  orderId: Types.ObjectId | null;
  phone: string;
  message: string;
  triggerType: SmsTriggerType;
  status: SmsStatus;
  providerCode: number | null;
  providerMessage: string;
  sentBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const smsLogSchema = new Schema<ISmsLog>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    phone: { type: String, required: true },
    message: { type: String, required: true },
    triggerType: {
      type: String,
      enum: ['new_order_offline', 'order_confirmation', 'admin_manual'],
      required: true,
    },
    status: {
      type: String,
      enum: ['sent', 'failed'],
      required: true,
    },
    providerCode: { type: Number, default: null },
    providerMessage: { type: String, default: '' },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

smsLogSchema.index({ tenantId: 1, createdAt: -1 });
smsLogSchema.index({ triggerType: 1, status: 1, createdAt: -1 });

export const SmsLog = model<ISmsLog>('SmsLog', smsLogSchema);
