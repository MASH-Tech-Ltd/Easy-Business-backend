import { Schema, model } from 'mongoose';
import { ISupportTicket } from './support.interface';

const supportMessageSchema = new Schema(
  {
    senderType: { type: String, enum: ['MERCHANT', 'ADMIN'], required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, required: true },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    ticketId: { type: String, required: true, unique: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: false },
    affiliateId: { type: Schema.Types.ObjectId, ref: 'Affiliate', required: false },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    category: { type: String, default: 'General' },
    subject: { type: String, required: true },
    status: {
      type: String,
      enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      default: 'OPEN',
    },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM',
    },
    messages: [supportMessageSchema],
  },
  {
    timestamps: true,
  }
);

export const SupportTicket = model<ISupportTicket>('SupportTicket', supportTicketSchema);
