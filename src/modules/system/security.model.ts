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
}

const blockedIpSchema = new Schema<IBlockedIp>({
  ipAddress: { type: String, required: true, unique: true },
  reason: { type: String, required: true },
  blockedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  type: { type: String, enum: ['manual', 'auto'], default: 'manual' }
});

export const BlockedIp = mongoose.model<IBlockedIp>('BlockedIp', blockedIpSchema);
