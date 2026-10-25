export type InquiryStatus = 'pending' | 'contacted' | 'resolved' | 'cancelled';
export type InquirySource = 'facebook' | 'google' | 'direct' | 'organic' | 'other';

export interface IContactInquiry {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  businessName?: string;
  topic: string;
  message: string;
  status: InquiryStatus;
  source?: InquirySource | string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  gclid?: string;
  landingPageUrl?: string;
  adminNotes?: string;
  ipAddress?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
