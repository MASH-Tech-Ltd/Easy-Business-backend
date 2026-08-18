import { Document, Types } from 'mongoose';

export interface ICourier extends Document {
  tenantId: Types.ObjectId;
  insideDhaka: number;
  outsideDhaka: number;
  provider?: string;
  clientId?: string;
  apiSecret?: string;
  autoForward?: boolean;
}
