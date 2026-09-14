import mongoose, { Document, Schema } from 'mongoose';

export interface IStoreVisit extends Document {
  tenantId: mongoose.Types.ObjectId;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
}

const storeVisitSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Create compound index so we can quickly find visits by tenant and session in a date range
storeVisitSchema.index({ tenantId: 1, sessionId: 1, createdAt: -1 });

export const StoreVisit = mongoose.model<IStoreVisit>('StoreVisit', storeVisitSchema);
