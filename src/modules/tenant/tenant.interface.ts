import { Document, Types } from 'mongoose';

export interface ITenant extends Document {
  name: string;
  tenetId: string;
  domain?: string | undefined;
  slug: string;
  customDomain?: string | undefined;
  logo?: string;
  ownerId?: Types.ObjectId;
  status: 'active' | 'inactive' | 'suspended' | 'pending' | 'banned';
  isOnline?: boolean;
  isOnlineByAdmin?: boolean;
  domainStatus?: 'pending' | 'active' | 'failed' | undefined;
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
