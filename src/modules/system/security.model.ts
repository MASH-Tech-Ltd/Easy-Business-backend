import mongoose, { Schema, Document } from 'mongoose';

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
  date: { type: Date, default: Date.now }
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
  role: 'Merchant' | 'Customer';
  ipAddress: string;
  userAgent: string;
  storeName?: string;
  ownerName?: string;
  accessedAt: Date;
}

const visitorLogSchema = new Schema<IVisitorLog>({
  role: { type: String, enum: ['Merchant', 'Customer'], required: true },
  ipAddress: { type: String, required: true },
  userAgent: { type: String, required: true },
  storeName: { type: String },
  ownerName: { type: String },
  accessedAt: { type: Date, default: Date.now }
});

export const VisitorLog = mongoose.model<IVisitorLog>('VisitorLog', visitorLogSchema);
