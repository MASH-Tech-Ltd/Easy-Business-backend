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
    // Run a dummy compare to mitigate timing attacks (prevent user enumeration)
    await bcrypt.compare(password as string, '$2b$12$dummyhashthatis29charslo');
    throw new CustomError(401, 'Invalid email or password');
  }

  const isPasswordMatch = await bcrypt.compare(password as string, user.password);
  if (!isPasswordMatch) {
    throw new CustomError(401, 'Invalid email or password');
  }

  const familyId = crypto.randomBytes(8).toString('hex');

  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    familyId,
  };

  const accessToken = jwt.sign(jwtPayload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn as any,
  });

  const refreshToken = jwt.sign(jwtPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as any,
  });

  const userObj = user.toObject();
  delete userObj.password;

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        refreshTokens: {
          $each: [{ token: refreshToken, familyId }],
          $slice: -2 // Allow up to 2 concurrent devices
        }
      }
    }
  );

  return {
    accessToken,
    refreshToken,
    user: userObj,
  };
};

const forgotPassword = async (email: string) => {
  // Prevent super_admin accounts from being reset via the public forgot password endpoint
  const user = await User.findOne({ email, role: { $ne: 'super_admin' } });
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

  const message = resetPasswordTemplate(otp, config.app.frontendUrl);

  try {
    await sendEmail(user.email, 'Password Reset Request', message);
  } catch (error) {
    await User.findByIdAndUpdate(user._id, {
      passwordResetToken: undefined,
      passwordResetExpires: undefined,
    });
    throw new CustomError(500, 'Email could not be sent');
  }

  const resetToken = jwt.sign({ _id: user._id }, config.jwt.resetSecret as string, {
    expiresIn: config.jwt.resetExpiresIn as any,
  });

  return { message: 'Email sent', resetToken };
};

const resetPassword = async (resetToken: string, otp: string, password: string) => {
  let decoded: any;
  try {
    decoded = jwt.verify(resetToken, config.jwt.resetSecret as string);
  } catch (error) {
    throw new CustomError(400, 'Invalid or expired reset token');
  }

  const passwordResetToken = crypto.createHash('sha256').update(otp).digest('hex');

  const user = await User.findOne({
    _id: decoded._id,
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
    decoded = jwt.verify(token, config.jwt.refreshSecret as string);
  } catch (error) {
    throw new CustomError(401, 'Invalid or expired refresh token');
  }

  const user = await User.findById(decoded._id);
  if (!user) {
    throw new CustomError(401, 'User not found');
  }

  const tokenExists = user.refreshTokens && user.refreshTokens.some(rt => rt.token === token);
  
  if (!tokenExists) {
    // SECURITY FIX: Refresh Token Reuse Detection
    // The token is valid (verified by jwt.verify) but not in the DB's active list.
    // This indicates an old, already consumed token is being reused.
    // We isolate and revoke ONLY the compromised device's sessions using its familyId.
    if (decoded.familyId) {
      await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: { familyId: decoded.familyId } } });
    } else {
      await User.updateOne({ _id: user._id }, { $set: { refreshTokens: [] } });
    }
    throw new CustomError(401, 'Security alert: Token reuse detected. Your session on this device has been revoked. Please log in again.');
  }

  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    familyId: decoded.familyId || crypto.randomBytes(8).toString('hex'),
  };

  const newAccessToken = jwt.sign(jwtPayload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn as any,
  });

  const newRefreshToken = jwt.sign(jwtPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as any,
  });

  await User.updateOne(
    { _id: user._id },
    { $pull: { refreshTokens: { token } } }
  );
  
  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        refreshTokens: {
          $each: [{ token: newRefreshToken, familyId: jwtPayload.familyId }],
          $slice: -2 // Allow up to 2 concurrent devices
        }
      }
    }
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user,
  };
};

const requestChangePassword = async (userId: string, oldPassword: string) => {
  const user = await User.findById(userId).select('+password');
  if (!user || !user.password) {
    throw new CustomError(404, 'User not found');
  }

  const isPasswordMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isPasswordMatch) {
    throw new CustomError(401, 'Incorrect old password');
  }

  const otp = otpGenerator.generate(6, { upperCaseAlphabets: false, specialChars: false, lowerCaseAlphabets: false });
  const passwordResetToken = crypto.createHash('sha256').update(otp).digest('hex');
  const passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000);

  await User.findByIdAndUpdate(user._id, {
    passwordResetToken,
    passwordResetExpires,
  });

  const message = `<p>Your OTP to change your password is: <strong>${otp}</strong></p><p>This is valid for 10 minutes.</p>`;

  try {
    await sendEmail(user.email, 'Password Change Request', message);
  } catch (error) {
    await User.findByIdAndUpdate(user._id, {
      passwordResetToken: undefined,
      passwordResetExpires: undefined,
    });
    throw new CustomError(500, 'Email could not be sent');
  }

  const resetToken = jwt.sign({ _id: user._id }, config.jwt.resetSecret as string, {
    expiresIn: config.jwt.resetExpiresIn as any,
  });

  return { message: 'OTP sent to email', resetToken };
};

const verifyChangePassword = async (resetToken: string, otp: string, newPassword: string) => {
  let decoded: any;
  try {
    decoded = jwt.verify(resetToken, config.jwt.resetSecret as string);
  } catch (error) {
    throw new CustomError(400, 'Invalid or expired reset token');
  }

  const passwordResetToken = crypto.createHash('sha256').update(otp).digest('hex');

  const user = await User.findOne({
    _id: decoded._id,
    passwordResetToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new CustomError(400, 'Invalid or expired OTP');
  }

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  await user.save(); // pre save hook hashes password

  return { message: 'Password changed successfully' };
};

const logout = async (token: string) => {
  if (!token) return;
  try {
    const decoded: any = jwt.verify(token, config.jwt.refreshSecret as string);
    const user = await User.findById(decoded._id);
    if (user) {
      await User.updateOne(
        { _id: user._id },
        { $pull: { refreshTokens: { token } } }
      );
    }
  } catch (error) {
    // ignore invalid token errors on logout
  }
};

export const AuthService = {
  register,
  login,
  forgotPassword,
  resetPassword,
  refreshToken,
  requestChangePassword,
  verifyChangePassword,
  logout,
};
