import mongoose, { Schema, Document } from 'mongoose';

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60; // 30 days (2,592,000 seconds)

export interface ISecurityLog extends Document {
  incidentType: string;
  endpoint: string;
  ipAddress: string;
  reason: string;
  requestedFrom: string; // e.g. Store, Merchant, Dashboard, Web/Admin, Mobile App
  user: string; // 'Anonymous / Guest' or user ID
  userAgent: string;
  date: Date;
}

const securityLogSchema = new Schema<ISecurityLog>({
  incidentType: { type: String, required: true },
  endpoint: { type: String, required: true },
  ipAddress: { type: String, required: true },
  reason: { type: String, required: true },
  requestedFrom: { type: String, default: 'Web' },
  user: { type: String, default: 'Anonymous / Guest' },
  userAgent: { type: String },
  date: { type: Date, default: Date.now, expires: THIRTY_DAYS_IN_SECONDS }
});

export const SecurityLog = mongoose.model<ISecurityLog>('SecurityLog', securityLogSchema);

export interface IBlockedIp extends Document {
  ipAddress: string;
  reason: string;
  blockedAt: Date;
  expiresAt?: Date;
  type: 'manual' | 'auto';
  userAgent?: string;
}

const blockedIpSchema = new Schema<IBlockedIp>({
  ipAddress: { type: String, required: true, unique: true },
  reason: { type: String, required: true },
  blockedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  type: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  userAgent: { type: String }
});

export const BlockedIp = mongoose.model<IBlockedIp>('BlockedIp', blockedIpSchema);

export interface IVisitorLog extends Document {
  role: 'Merchant' | 'Customer' | 'Super Admin' | 'Guest';
  ipAddress: string;
  userAgent: string;
  storeName?: string;
  ownerName?: string;
  location?: string;
  accessedAt: Date;
}

const visitorLogSchema = new Schema<IVisitorLog>({
  role: { type: String, enum: ['Merchant', 'Customer', 'Super Admin', 'Guest'], required: true },
  ipAddress: { type: String, required: true },
  location: { type: String, default: 'Unknown' },
  userAgent: { type: String, default: 'Unknown' },
  storeName: { type: String },
  ownerName: { type: String },
  accessedAt: { type: Date, default: Date.now, expires: THIRTY_DAYS_IN_SECONDS }
});

export const VisitorLog = mongoose.model<IVisitorLog>('VisitorLog', visitorLogSchema);

