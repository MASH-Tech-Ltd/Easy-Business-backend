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
import { newRegistrationTemplate } from '../../templates/newRegistration';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

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

    try {
      const emailContent = newRegistrationTemplate(user.email as string, user.name || '');
      await sendEmail('sabbir00921@gmail.com', 'New User Registration Notification', emailContent);
    } catch (err) {
      console.error('Failed to send registration notification email:', err);
    }

    const userObj = user.toObject();
    delete userObj.password;
    return userObj;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const login = async (payload: Partial<IUser>): Promise<any> => {
  const { email, password, code } = payload;
  const user = await User.findOne({ email: email as string }).select('+password +twoFactorSecret +twoFactorRecoveryCodes');
  
  if (!user || !user.password) {
    // Run a dummy compare to mitigate timing attacks (prevent user enumeration)
    await bcrypt.compare(password as string, '$2b$12$dummyhashthatis29charslo');
    throw new CustomError(401, 'Invalid email or password');
  }

  const isPasswordMatch = await bcrypt.compare(password as string, user.password);
  if (!isPasswordMatch) {
    throw new CustomError(401, 'Invalid email or password');
  }

  // Check 2FA requirement
  if (user.twoFactorEnabled) {
    if (!code) {
      const twoFactorToken = jwt.sign(
        { _id: user._id, role: user.role, is2FA: true },
        config.jwt.accessSecret,
        { expiresIn: '5m' }
      );
      return {
        requires2FA: true,
        twoFactorToken,
        user: { _id: user._id, email: user.email, role: user.role },
      };
    }

    // Verify 2FA code if passed during login
    const isOtpValid = user.twoFactorSecret && speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code.trim(),
      window: 1,
    });
    let recoveryUsed = false;
    let recoveryIndex = -1;
    if (!isOtpValid && user.twoFactorRecoveryCodes) {
      recoveryIndex = user.twoFactorRecoveryCodes.indexOf(code.trim().toUpperCase());
      if (recoveryIndex !== -1) recoveryUsed = true;
    }
    if (!isOtpValid && !recoveryUsed) {
      throw new CustomError(400, 'Invalid 2FA authenticator code or recovery code');
    }
    if (recoveryUsed && user.twoFactorRecoveryCodes) {
      user.twoFactorRecoveryCodes.splice(recoveryIndex, 1);
      await user.save();
    }
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
  delete userObj.twoFactorSecret;
  delete userObj.twoFactorRecoveryCodes;

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
    // RACE CONDITION FIX FOR TOKEN ROTATION:
    // If multiple parallel requests hit /auth/refresh-token at the exact moment the access token expires (e.g. after 8-15 min),
    // Request 1 consumes the token first. Request 2 arrives milliseconds later with the same token.
    // If the token is valid (verified by jwt.verify above) and was issued within the last 30 seconds,
    // it is a parallel in-flight request from the same browser session. Return a fresh access token for the active session
    // instead of triggering false-positive security revocation.
    const now = Date.now();
    const tokenIssuedAt = (decoded.iat || 0) * 1000;
    const isRecentlyIssued = (now - tokenIssuedAt) < 30_000; // 30-second grace window for concurrent request bursts

    if (isRecentlyIssued && decoded.familyId) {
      const familyToken = user.refreshTokens && user.refreshTokens.find(rt => rt.familyId === decoded.familyId);
      if (familyToken) {
        const jwtPayload = {
          _id: user._id,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
          familyId: decoded.familyId,
        };
        const newAccessToken = jwt.sign(jwtPayload, config.jwt.accessSecret, {
          expiresIn: config.jwt.accessExpiresIn as any,
        });
        return {
          accessToken: newAccessToken,
          refreshToken: familyToken.token,
          user,
        };
      }
    }

    // Actual stolen token reuse (outside 30s grace window) -> revoke session for that device family
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
          $slice: -3 // Allow up to 4 active devices per user
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

const changePasswordDirect = async (userId: string, oldPassword: string, newPassword: string) => {
  const user = await User.findById(userId).select('+password');
  if (!user || !user.password) {
    throw new CustomError(404, 'User not found');
  }

  const isPasswordMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isPasswordMatch) {
    throw new CustomError(400, 'Incorrect current password');
  }

  if (!newPassword || newPassword.length < 8) {
    throw new CustomError(400, 'New password must be at least 8 characters long');
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
  if (!passwordRegex.test(newPassword)) {
    throw new CustomError(400, 'New password must contain at least one uppercase letter, one lowercase letter, and one number');
  }

  user.password = newPassword;
  await user.save();

  return { message: 'Password updated successfully' };
};

const setup2FA = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError(404, 'User not found');
  }

  const secret = speakeasy.generateSecret({
    length: 20,
    name: `MASH ECO (${user.email})`,
    issuer: 'Mash Eco Platform',
  });

  user.twoFactorTempSecret = secret.base32;
  await user.save();

  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || '');

  return {
    qrCodeUrl,
    secret: secret.base32,
  };
};

const verifyEnable2FA = async (userId: string, code: string) => {
  const user = await User.findById(userId).select('+twoFactorTempSecret');
  if (!user || !user.twoFactorTempSecret) {
    throw new CustomError(400, '2FA setup has not been initiated. Please start setup again.');
  }

  const verified = speakeasy.totp.verify({
    secret: user.twoFactorTempSecret,
    encoding: 'base32',
    token: code.trim(),
    window: 1,
  });

  if (!verified) {
    throw new CustomError(400, 'Invalid authenticator code. Please double check the code from your app.');
  }

  const recoveryCodes = Array.from({ length: 8 }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase()
  );

  user.twoFactorSecret = user.twoFactorTempSecret;
  user.twoFactorEnabled = true;
  user.set('twoFactorTempSecret', undefined);
  user.twoFactorRecoveryCodes = recoveryCodes;
  await user.save();

  return {
    message: '2FA authenticator successfully enabled!',
    recoveryCodes,
  };
};

const disable2FA = async (userId: string, code?: string) => {
  const user = await User.findById(userId).select('+twoFactorSecret +twoFactorRecoveryCodes');
  if (!user) {
    throw new CustomError(404, 'User not found');
  }

  if (user.twoFactorEnabled && code) {
    const isOtpValid = user.twoFactorSecret && speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code.trim(),
      window: 1,
    });
    const isRecoveryCode = user.twoFactorRecoveryCodes?.includes(code.trim().toUpperCase());

    if (!isOtpValid && !isRecoveryCode) {
      throw new CustomError(400, 'Invalid 2FA code or recovery code');
    }
  }

  user.twoFactorEnabled = false;
  user.set('twoFactorSecret', undefined);
  user.set('twoFactorTempSecret', undefined);
  user.twoFactorRecoveryCodes = [];
  await user.save();

  return { message: '2FA authenticator successfully disabled.' };
};

const get2FAStatus = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError(404, 'User not found');
  }
  return {
    twoFactorEnabled: !!user.twoFactorEnabled,
  };
};

const verify2FALogin = async (twoFactorToken: string, code: string) => {
  let decoded: any;
  try {
    decoded = jwt.verify(twoFactorToken, config.jwt.accessSecret);
  } catch (err) {
    throw new CustomError(401, '2FA session expired. Please log in again.');
  }

  if (!decoded || !decoded._id) {
    throw new CustomError(401, 'Invalid 2FA session');
  }

  const user = await User.findById(decoded._id).select('+password +twoFactorSecret +twoFactorRecoveryCodes');
  if (!user || !user.twoFactorSecret) {
    throw new CustomError(400, 'User 2FA setup not found');
  }

  const isOtpValid = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: code.trim(),
    window: 1,
  });

  let recoveryUsed = false;
  let recoveryIndex = -1;
  if (!isOtpValid && user.twoFactorRecoveryCodes) {
    recoveryIndex = user.twoFactorRecoveryCodes.indexOf(code.trim().toUpperCase());
    if (recoveryIndex !== -1) recoveryUsed = true;
  }

  if (!isOtpValid && !recoveryUsed) {
    throw new CustomError(400, 'Invalid authenticator code or recovery code.');
  }

  if (recoveryUsed && user.twoFactorRecoveryCodes) {
    user.twoFactorRecoveryCodes.splice(recoveryIndex, 1);
    await user.save();
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
  delete userObj.twoFactorSecret;
  delete userObj.twoFactorRecoveryCodes;

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        refreshTokens: {
          $each: [{ token: refreshToken, familyId }],
          $slice: -2
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
  changePasswordDirect,
  logout,
  setup2FA,
  verifyEnable2FA,
  disable2FA,
  get2FAStatus,
  verify2FALogin,
};
