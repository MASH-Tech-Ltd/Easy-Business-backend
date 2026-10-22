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
import { welcomeUserTemplate } from '../../templates/welcomeUser';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

import mongoose from 'mongoose';
import { Tenant } from '../tenant/tenant.model';
import slugify from 'slugify';
import { Subscription } from '../subscription/subscription.model';
import { Referral, ReferralUsage, ReferralReward } from '../referral/referral.model';
import { notificationService } from '../notification/notification.service';
import { GlobalSetting } from '../system/globalSetting.model';

const assertMerchantNotBanned = async (user: any) => {
  if (user.role === 'tenant_admin') {
    const tenant = await Tenant.findOne({
      $or: [
        ...(user.tenantId ? [{ _id: user.tenantId }] : []),
        { ownerId: user._id },
      ],
      status: 'banned',
    }).select('status').lean();
    if (tenant) {
      throw new CustomError(403, 'Your merchant account has been banned. Please contact support.');
    }
  }
};


const register = async (payload: Partial<IUser> & { storeName?: string; referralCode?: string }): Promise<{ user: any; accessToken: string; refreshToken: string }> => {
  // CRITICAL SECURITY FIX: Check if public registration is globally enabled
  const globalSettings = await GlobalSetting.findOne();
  if (globalSettings && globalSettings.allowRegistration === false) {
    throw new CustomError(403, 'Public registration is currently disabled by system administrator.');
  }

  // Reject any attempt to self-assign super_admin, admin, or privileged roles
  const incomingRole = (payload.role as any)?.toString().toLowerCase() || '';
  if (incomingRole.includes('super') || incomingRole.includes('admin')) {
    throw new CustomError(403, 'Administrative accounts cannot be created via public registration. Admin accounts are provisioned internally.');
  }

  // Ensure storeName is explicitly provided and valid (prevent generic admin registration probes)
  const rawStoreName = payload.storeName?.trim();
  if (!rawStoreName || rawStoreName.length < 2) {
    throw new CustomError(400, 'A valid store name (minimum 2 characters) is required for merchant registration.');
  }

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

    // Optional Referral Code handling
    const rawReferralCode = typeof payload.referralCode === 'string' ? payload.referralCode.trim().toUpperCase() : '';
    delete payload.referralCode;

    let referralDoc: any = null;
    let extraTrialDays = 0;

    if (rawReferralCode) {
      referralDoc = await Referral.findOne({ code: rawReferralCode });

      if (!referralDoc) {
        throw new CustomError(400, `Invalid referral code "${rawReferralCode}". Please check the code or leave it empty.`);
      }

      if (!referralDoc.isActive) {
        throw new CustomError(400, `The referral code "${rawReferralCode}" is no longer active.`);
      }

      if (referralDoc.expiresAt && new Date(referralDoc.expiresAt).getTime() < Date.now()) {
        throw new CustomError(400, `The referral code "${rawReferralCode}" has expired.`);
      }

      if (typeof referralDoc.maxUses === 'number' && referralDoc.maxUses > 0 && referralDoc.usedCount >= referralDoc.maxUses) {
        throw new CustomError(400, `The referral code "${rawReferralCode}" has reached its maximum redemption limit.`);
      }

      if (referralDoc.offerType === 'subscription_discount') {
        extraTrialDays = 0; // standard trial only, discount is for subscription
      } else {
        extraTrialDays = Number(referralDoc.extraDays) >= 0 ? Number(referralDoc.extraDays) : 10;
      }
    }

    // Distinguish between Store/Business Name and Owner/User Name
    const rawStoreName = payload.storeName?.trim() || '';
    const rawOwnerName = payload.name?.trim() || '';
    const storeName = rawStoreName || rawOwnerName || 'My Store';
    const ownerName = rawOwnerName || rawStoreName || 'Store Owner';

    delete payload.storeName;
    payload.name = ownerName;

    // Prepare tenant creation
    let tenantId = null;
    let createdTenant = null;

    const baseSlug = slugify(storeName, { lower: true, strict: true }) || 'store';
    const uniqueSuffix = Math.floor(1000 + Math.random() * 9000);
    const slug = `${baseSlug}-${uniqueSuffix}`;

    const tenant = new Tenant({
      name: storeName,
      slug: slug,
      domain: undefined,
      customDomain: undefined,
      status: 'active',
      referralCodeUsed: referralDoc ? referralDoc.code : undefined,
      referredBy: referralDoc ? (referralDoc.referrerName || 'Referral Partner') : undefined,
      referralDiscount:
        referralDoc && (referralDoc.offerType === 'subscription_discount' || referralDoc.offerType === 'both')
          ? {
              referralCode: referralDoc.code,
              discountType: referralDoc.discountType || 'percentage',
              discountValue: referralDoc.discountValue || 0,
              used: false,
            }
          : undefined,
    });

    createdTenant = await tenant.save({ session });
    tenantId = createdTenant._id;
    payload.tenantId = tenantId;

    const user = new User(payload);
    await user.save({ session });

    if (createdTenant) {
      createdTenant.ownerId = user._id;
      await createdTenant.save({ session });

      // Create free trial subscription
      // Standard trial is 5 days. If a referral code is used, add extra trial days (default +10 days -> 15 days total!)
      const baseTrialDays = 5;
      const totalTrialDays = baseTrialDays + extraTrialDays;

      const trialStart = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + totalTrialDays);

      const freeSubscription = new Subscription({
        tenantId: createdTenant._id,
        packageId: null,   // No paid package needed for free tier
        startDate: trialStart,
        endDate: trialEnd,
        status: 'active',
        isTrial: true,
      });
      await freeSubscription.save({ session });

      // If a valid referral was applied, record usage and increment count
      if (referralDoc) {
        referralDoc.usedCount = (referralDoc.usedCount || 0) + 1;
        await referralDoc.save({ session });

        // Only award referral points if the code was created by an existing merchant
        const isMerchantReferrer = Boolean(referralDoc.isMerchantCode && referralDoc.referrerTenantId);
        const pointsToAward = isMerchantReferrer ? (Number(referralDoc.pointsPerReferral) || 20) : 0;

        await ReferralUsage.create(
          [
            {
              referralId: referralDoc._id,
              referralCode: referralDoc.code,
              referrerUserId: referralDoc.referrerUserId || null,
              referrerTenantId: referralDoc.referrerTenantId || null,
              referredUserId: user._id,
              referredTenantId: createdTenant._id,
              referredEmail: user.email || '',
              referredStoreName: storeName,
              extraDaysAwarded: extraTrialDays,
              pointsAwarded: pointsToAward,
              pointsStatus: isMerchantReferrer ? 'pending' : 'usable',
              createdAt: new Date(),
            },
          ],
          { session }
        );

        // If the referral belongs to an existing merchant, add pending points to their wallet
        if (referralDoc.referrerTenantId) {
          let referrerReward = await ReferralReward.findOne({ tenantId: referralDoc.referrerTenantId }).session(session);
          if (!referrerReward) {
            referrerReward = new ReferralReward({
              tenantId: referralDoc.referrerTenantId,
              userId: referralDoc.referrerUserId || user._id,
              totalPoints: pointsToAward,
              pendingPoints: pointsToAward,
              usablePoints: 0,
              withdrawnPoints: 0,
              totalTakaWithdrawn: 0,
            });
          } else {
            referrerReward.totalPoints = (referrerReward.totalPoints || 0) + pointsToAward;
            referrerReward.pendingPoints = (referrerReward.pendingPoints || 0) + pointsToAward;
          }
          await referrerReward.save({ session });
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

    try {
      // Send welcome email to newly registered user
      if (user.email) {
        const welcomeContent = welcomeUserTemplate(user.name || '');
        await sendEmail(user.email, 'MASH ECO-তে আপনাকে স্বাগতম!', welcomeContent);
      }

      // Send in-app notification to user about referral benefits if applied
      if (referralDoc) {
        let notifTitle = '🎉 Referral Offer Applied!';
        let notifMessage = '';

        if (referralDoc.offerType === 'both') {
          const discountStr = `${referralDoc.discountValue}${referralDoc.discountType === 'fixed' ? '৳' : '%'}`;
          notifMessage = `Congratulations! You received ${extraTrialDays} days extra free trial (total ${5 + extraTrialDays} days) and a ${discountStr} discount on your first subscription plan!`;
        } else if (referralDoc.offerType === 'subscription_discount') {
          const discountStr = `${referralDoc.discountValue}${referralDoc.discountType === 'fixed' ? '৳' : '%'}`;
          notifMessage = `Congratulations! You received a ${discountStr} discount on your first subscription package!`;
        } else {
          notifMessage = `Congratulations! You received ${extraTrialDays} days extra free trial (total ${5 + extraTrialDays} days free) to build and launch your store!`;
        }

        await notificationService.createNotification(
          user._id,
          'REFERRAL_REWARD',
          notifTitle,
          notifMessage,
          createdTenant?._id,
          createdTenant?._id
        );
      } else {
        // Welcome notification for standard registration
        await notificationService.createNotification(
          user._id,
          'WELCOME',
          '👋 Welcome to MASH ECO!',
          'Your online store is ready. Enjoy your 5-day free trial to set up products and start selling.',
          createdTenant?._id,
          createdTenant?._id
        );
      }

      // Send registration notification to admin only in production (skip in local/development)
      if (config.app.env === 'production') {
        const adminEmailContent = newRegistrationTemplate(user.email as string, user.name || '');
        await sendEmail('sabbir00921@gmail.com', 'New User Registration Notification', adminEmailContent);
      }
    } catch (err) {
      console.error('Failed to send registration notification / email:', err);
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

    if (createdTenant) {
      (userObj as any).storeName = createdTenant.name;
      (userObj as any).tenantSlug = createdTenant.slug;
      (userObj as any).storeLogo = createdTenant.logo;
    }

    await User.updateOne(
      { _id: user._id },
      {
        $push: {
          refreshTokens: {
            token: refreshToken,
            familyId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
      }
    );

    return {
      user: userObj,
      accessToken,
      refreshToken,
    };
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

  await assertMerchantNotBanned(user);

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

  if (user.tenantId) {
    try {
      const tenant = await Tenant.findById(user.tenantId).select('name slug logo');
      if (tenant) {
        (userObj as any).storeName = tenant.name;
        (userObj as any).tenantSlug = tenant.slug;
        (userObj as any).storeLogo = tenant.logo;
      }
    } catch (err) {
      console.error('Failed to attach tenant name in login:', err);
    }
  }

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

  await assertMerchantNotBanned(user);

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
