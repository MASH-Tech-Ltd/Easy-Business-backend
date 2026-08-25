import { IUser } from './auth.interface';
import { User } from './auth.model';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../../config';

import mongoose from 'mongoose';
import { Tenant } from '../tenant/tenant.model';
import slugify from 'slugify';
import { Subscription } from '../subscription/subscription.model';

const register = async (payload: Partial<IUser>): Promise<Omit<IUser, 'password'>> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // SECURITY FIX: Never allow clients to self-assign privileged roles.
    // Strip role and tenantId from the incoming payload entirely.
    // super_admin is ONLY set by the seed script (seedSuperAdmin.ts).
    delete payload.role;
    delete payload.tenantId;

    // All registrations via public endpoint default to tenant_admin (new merchant)
    payload.role = 'tenant_admin';

    // Prepare tenant creation
    let tenantId = null;
    let createdTenant = null;

    const baseSlug = slugify(payload.name || 'store', { lower: true, strict: true });
    const uniqueSuffix = Math.floor(1000 + Math.random() * 9000);
    const slug = `${baseSlug}-${uniqueSuffix}`;

    const tenant = new Tenant({
      name: `${payload.name || 'My'} Store`,
      slug: slug,
      domain: undefined,
      status: 'active',
    });

    createdTenant = await tenant.save({ session });
    tenantId = createdTenant._id;
    payload.tenantId = tenantId;

    const user = new User(payload);
    await user.save({ session });

    if (createdTenant) {
      createdTenant.ownerId = user._id;
      await createdTenant.save({ session });

      // Always create a 5-day free trial for every new merchant
      const trialStart = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 5);

      const trialSubscription = new Subscription({
        tenantId: createdTenant._id,
        packageId: null,   // No paid package needed for trial
        startDate: trialStart,
        endDate: trialEnd,
        status: 'active',
        isTrial: true,
      });
      await trialSubscription.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    const userObj = user.toObject();
    delete userObj.password;
    return userObj;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const login = async (payload: Partial<IUser>): Promise<{ accessToken: string, user: any }> => {
  const { email, password } = payload;
  const user = await User.findOne({ email: email as string }).select('+password');
  
  if (!user || !user.password) {
    throw new Error('User not found or password not set');
  }

  const isPasswordMatch = await bcrypt.compare(password as string, user.password);
  if (!isPasswordMatch) {
    throw new Error('Invalid email or password');
  }

  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  };

  const accessToken = jwt.sign(jwtPayload, config.jwt_secret, {
    expiresIn: config.jwt_expires_in as any,
  });

  const userObj = user.toObject();
  delete userObj.password;

  return {
    accessToken,
    user: userObj,
  };
};

export const AuthService = {
  register,
  login,
};
