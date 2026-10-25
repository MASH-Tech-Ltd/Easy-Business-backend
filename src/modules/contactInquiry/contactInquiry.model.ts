import { Schema, model } from 'mongoose';
import { IContactInquiry } from './contactInquiry.interface';

const contactInquirySchema = new Schema<IContactInquiry>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: false, default: '', trim: true },
    businessName: { type: String, required: false, default: '', trim: true },
    topic: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'contacted', 'resolved', 'cancelled'],
      default: 'pending',
    },
    source: { type: String, default: 'direct', trim: true },
    utmSource: { type: String, default: '', trim: true },
    utmMedium: { type: String, default: '', trim: true },
    utmCampaign: { type: String, default: '', trim: true },
    utmContent: { type: String, default: '', trim: true },
    utmTerm: { type: String, default: '', trim: true },
    fbclid: { type: String, default: '', trim: true },
    gclid: { type: String, default: '', trim: true },
    landingPageUrl: { type: String, default: '', trim: true },
    adminNotes: { type: String, default: '' },
    ipAddress: { type: String, default: 'Unknown' },
  },
  { timestamps: true }
);

contactInquirySchema.index({ status: 1, createdAt: -1 });
contactInquirySchema.index({ source: 1, createdAt: -1 });
contactInquirySchema.index({ phone: 1 });
contactInquirySchema.index({ createdAt: -1 });

export const ContactInquiry = model<IContactInquiry>('ContactInquiry', contactInquirySchema);
