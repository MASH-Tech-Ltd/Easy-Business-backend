import { IUser } from './auth.interface';
import { User } from './auth.model';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../../config';
import CustomError from '../../helpers/CustomError';
import crypto from 'crypto';
import otpGenerator from 'otp-generator';
import { sendEmail } from '../../utils/sendEmail';
import { resetPasswordTemplate } from '../../templates/resetPassword';

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
      name: `${payload.name || 'My Store'}`,
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

      const freeSubscription = new Subscription({
        tenantId: createdTenant._id,
        packageId: null,   // No paid package needed for free tier
        startDate: trialStart,
        endDate: trialEnd,
        status: 'active',
        isTrial: true,
      });
      await freeSubscription.save({ session });
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

const login = async (payload: Partial<IUser>): Promise<{ accessToken: string, refreshToken: string, user: any }> => {
  const { email, password } = payload;
  const user = await User.findOne({ email: email as string }).select('+password');
  
  if (!user || !user.password) {
    throw new CustomError(401, 'Invalid email or password');
  }

  const isPasswordMatch = await bcrypt.compare(password as string, user.password);
  if (!isPasswordMatch) {
    throw new CustomError(401, 'Invalid email or password');
  }

  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  };

  const accessToken = jwt.sign(jwtPayload, config.jwt_access_secret, {
    expiresIn: config.jwt_access_expires_in as any,
  });

  const refreshToken = jwt.sign(jwtPayload, config.jwt_refresh_secret, {
    expiresIn: config.jwt_refresh_expires_in as any,
  });

  const userObj = user.toObject();
  delete userObj.password;

  return {
    accessToken,
    refreshToken,
    user: userObj,
  };
};

const forgotPassword = async (email: string) => {
  const user = await User.findOne({ email });
  if (!user) {
    throw new CustomError(404, 'User not found');
  }

  const otp = otpGenerator.generate(6, { upperCaseAlphabets: false, specialChars: false, lowerCaseAlphabets: false });
  const passwordResetToken = crypto.createHash('sha256').update(otp).digest('hex');

  const passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await User.findByIdAndUpdate(user._id, {
    passwordResetToken,
    passwordResetExpires,
  });

  const message = resetPasswordTemplate(otp, config.frontendUrl);

  try {
    await sendEmail(user.email, 'Password Reset Request', message);
  } catch (error) {
    await User.findByIdAndUpdate(user._id, {
      passwordResetToken: undefined,
      passwordResetExpires: undefined,
    });
    throw new CustomError(500, 'Email could not be sent');
  }

  return { message: 'Email sent' };
};

const resetPassword = async (otp: string, password: string) => {
  const passwordResetToken = crypto.createHash('sha256').update(otp).digest('hex');

  const user = await User.findOne({
    passwordResetToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new CustomError(400, 'Invalid or expired token');
  }

  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  await user.save(); // pre save hook hashes password

  return { message: 'Password reset successfully' };
};
//regenerate access token from refresh token
const refreshToken = async (token: string) => {
  if (!token) {
    throw new CustomError(401, 'Refresh token is required');
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, config.jwt_refresh_secret as string);
  } catch (error) {
    throw new CustomError(401, 'Invalid or expired refresh token');
  }

  const user = await User.findById(decoded._id);
  if (!user) {
    throw new CustomError(401, 'User not found');
  }

  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  };

  const newAccessToken = jwt.sign(jwtPayload, config.jwt_access_secret, {
    expiresIn: config.jwt_access_expires_in as any,
  });

  const newRefreshToken = jwt.sign(jwtPayload, config.jwt_refresh_secret, {
    expiresIn: config.jwt_refresh_expires_in as any,
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
};

export const AuthService = {
  register,
  login,
  forgotPassword,
  resetPassword,
  refreshToken,
};
