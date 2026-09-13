import { Schema, model } from 'mongoose';
import { IUser } from './auth.interface';
import bcrypt from 'bcrypt';
import config from '../../config';

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, select: false },
    role: { type: String, enum: ['super_admin', 'tenant_admin', 'customer'], default: 'customer' },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    phone: { type: String },
    address: { type: String },
    details: { type: String },
    avatar: {
      public_id: { type: String },
      secure_url: { type: String }
    },
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date }
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  if (this.password) {
    this.password = await bcrypt.hash(this.password as string, config.security.bcryptSaltRounds);
  }
});

export const User = model<IUser>('User', userSchema);
