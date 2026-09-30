import { Document, Types } from 'mongoose';

export interface ICourier extends Document {
  tenantId: Types.ObjectId;
  insideDhaka: number;
  outsideDhaka: number;
  provider?: string; // Active or default provider
  clientId?: string; // Legacy
  apiSecret?: string; // Legacy
  autoForward?: boolean; // Legacy
  providers?: {
    [key: string]: {
      clientId?: string;
      apiSecret?: string;
      autoForward?: boolean;
      isActive?: boolean;
    };
  };
}
