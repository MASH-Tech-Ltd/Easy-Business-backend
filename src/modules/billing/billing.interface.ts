import { Document, Types } from 'mongoose';

export interface IPlatformPaymentAccount {
  id: string;
  provider: 'bKash' | 'Nagad' | 'Rocket' | 'Upay' | 'Bank Transfer' | 'EPS (Easy Payment System)' | 'Other';
  type: 'Personal' | 'Agent' | 'Merchant' | 'Bank Account';
  accountNumber: string;
  accountName?: string;
  bankName?: string;
  branchName?: string;
  instructions: string;
  isActive: boolean;
}

export interface IPlatformPaymentSubmission extends Document {
  tenantId: Types.ObjectId | string;
  purpose: 'addon' | 'package' | 'renewal' | 'other';
  purposeTitle: string;
  amount: number;
  provider: string;
  senderNumber: string;
  transactionId: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
  adminFeedback?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPlatformPaymentSettings extends Document {
  accounts: IPlatformPaymentAccount[];
  gatewaySettings?: {
    sslCommerzEnabled: boolean;
    bKashCheckoutEnabled: boolean;
    stripeEnabled: boolean;
  };
}
