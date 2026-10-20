import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IBackupLog extends Document {
  status: 'success' | 'failed' | 'bypassed';
  backupFile?: string;
  recordsDetail?: Record<string, number>;
  message?: string;
  triggerType: 'manual' | 'scheduled';
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const backupLogSchema = new Schema<IBackupLog>(
  {
    status: {
      type: String,
      enum: ['success', 'failed', 'bypassed'],
      required: true,
    },
    backupFile: {
      type: String,
      required: false,
    },
    recordsDetail: {
      type: Schema.Types.Mixed,
      required: false,
    },
    message: {
      type: String,
      required: false,
    },
    triggerType: {
      type: String,
      enum: ['manual', 'scheduled'],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

backupLogSchema.index({ timestamp: -1 });

export const BackupLogModel: Model<IBackupLog> =
  mongoose.models.BackupLog || mongoose.model<IBackupLog>('BackupLog', backupLogSchema);
