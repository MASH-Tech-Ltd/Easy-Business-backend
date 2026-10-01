import { Schema, model } from 'mongoose';
import { IPlatformPaymentSubmission, IPlatformPaymentSettings } from './billing.interface';

const platformPaymentSubmissionSchema = new Schema<IPlatformPaymentSubmission>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    purpose: { type: String, enum: ['addon', 'package', 'renewal', 'other'], default: 'addon' },
    purposeTitle: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    provider: { type: String, required: true },
    senderNumber: { type: String, required: true },
    transactionId: { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    note: { type: String },
    adminFeedback: { type: String },
  },
  { timestamps: true }
);

export const PlatformPaymentSubmission = model<IPlatformPaymentSubmission>(
  'PlatformPaymentSubmission',
  platformPaymentSubmissionSchema
);

const platformPaymentSettingsSchema = new Schema<IPlatformPaymentSettings>(
  {
    accounts: [
      {
        id: { type: String, required: true },
        provider: { type: String, required: true },
        type: { type: String, required: true },
        accountNumber: { type: String, required: true },
        accountName: { type: String },
        bankName: { type: String },
        branchName: { type: String },
        instructions: { type: String, default: '' },
        isActive: { type: Boolean, default: true },
      },
    ],
    gatewaySettings: {
      sslCommerzEnabled: { type: Boolean, default: false },
      bKashCheckoutEnabled: { type: Boolean, default: false },
      stripeEnabled: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

export const PlatformPaymentSettings = model<IPlatformPaymentSettings>(
  'PlatformPaymentSettings',
  platformPaymentSettingsSchema
);
