import { Document, Types } from 'mongoose';

export interface INotification extends Document {
  recipientId: Types.ObjectId;
  tenantId?: Types.ObjectId;
  type: string;
  title: string;
  message: string;
  read: boolean;
  relatedEntityId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
