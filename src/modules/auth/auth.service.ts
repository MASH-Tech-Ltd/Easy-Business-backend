import { IUser } from './auth.interface';
import { User } from './auth.model';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../../config';

import mongoose from 'mongoose';
import { Tenant } from '../tenant/tenant.model';
import slugify from 'slugify';
import { Package } from '../package/package.model';
import { Subscription } from '../subscription/subscription.model';

const register = async (payload: Partial<IUser>): Promise<Omit<IUser, 'password'>> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (payload.email === config.super_admin_email) {
      payload.role = 'super_admin';
    }

    // Prepare tenant creation if applicable
    let tenantId = null;
    let createdTenant = null;

    if (payload.role === 'tenant_admin' || !payload.role) {
      payload.role = 'tenant_admin'; // Default role
      
      const baseSlug = slugify(payload.name || 'store', { lower: true, strict: true });
      const uniqueSuffix = Math.floor(1000 + Math.random() * 9000); // 4 digit random number
      const slug = `${baseSlug}-${uniqueSuffix}`;
      
      const tenant = new Tenant({
        name: `${payload.name || 'My'} Store`,
        slug: slug,
        domain: undefined,
        status: 'active', // or pending depending on business logic
      });
      
      createdTenant = await tenant.save({ session });
      tenantId = createdTenant._id;
      payload.tenantId = tenantId;
    }

    const user = new User(payload);
    await user.save({ session });

    if (createdTenant) {
      createdTenant.ownerId = user._id;
      await createdTenant.save({ session });

      const freePackage = await Package.findOne({ price: 0, billingCycle: 'monthly' }).session(session);
      if (freePackage) {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);

        const subscription = new Subscription({
          tenantId: createdTenant._id,
          packageId: freePackage._id,
          startDate,
          endDate,
          status: 'active',
        });
        await subscription.save({ session });
      }
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
