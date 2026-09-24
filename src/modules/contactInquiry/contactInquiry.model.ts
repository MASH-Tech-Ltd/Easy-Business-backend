import { Schema, model } from 'mongoose';
import { IContactInquiry } from './contactInquiry.interface';

const contactInquirySchema = new Schema<IContactInquiry>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    topic: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['pending', 'resolved'], default: 'pending' },
    ipAddress: { type: String, default: 'Unknown' },
  },
  { timestamps: true }
);

export const ContactInquiry = model<IContactInquiry>('ContactInquiry', contactInquirySchema);
