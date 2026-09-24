import { Document, Types } from 'mongoose';

export interface ITenant extends Document {
  name: string;
  tenetId: string;
  domain: string;
  slug: string;
  customDomain?: string;
  logo?: string;
  ownerId?: Types.ObjectId;
  status: 'active' | 'suspended' | 'pending';
  domainStatus?: 'pending' | 'active' | 'failed';
  sslValidationRecords?: any[];
  contactEmail?: string;
  contactPhone?: string;
  contactAddress?: string;
  description?: string;
  theme?: Record<string, any>;
  settings?: Record<string, any>;
  showDemoSeed?: boolean;
  slugChanges?: Date[];
}
