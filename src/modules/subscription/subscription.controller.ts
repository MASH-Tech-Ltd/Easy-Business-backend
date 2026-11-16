import { Request, Response } from 'express';
import { SubscriptionService } from './subscription.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { Subscription } from './subscription.model';
import { User } from '../auth/auth.model';
import { sendEmail } from '../../utils/sendEmail';
import { subscriptionExpiryReminderTemplate } from '../../templates/subscriptionExpiryReminder';
import { notificationService } from '../notification/notification.service';
import config from '../../config';
import { getClientIp } from '../../utils/ipHelper';

const assignPackage = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.assignPackage(req.body);
  ApiResponse.sendSuccess(res, 201, 'Package assigned to tenant successfully', result);
});

const getTenantSubscription = asyncHandler(async (req: Request, res: Response) => {
  const callerRole = (req as any).user.role;
  const callerTenantId = (req as any).user.tenantId?.toString();
  const requestedTenantId = req.params.tenantId as string;

  // SECURITY FIX: tenant_admin can only view their own subscription — prevent IDOR
  if (callerRole === 'tenant_admin' && callerTenantId !== requestedTenantId) {
    return ApiResponse.sendError(res, 403, 'Forbidden: You can only view your own subscription');
  }

  const result = await SubscriptionService.getTenantSubscription(requestedTenantId);
  ApiResponse.sendSuccess(res, 200, 'Tenant subscription retrieved successfully', result);
});

const getMySubscription = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const includeExpired = req.query.includeExpired === 'true';

  const result = await SubscriptionService.getTenantSubscription(tenantId);

  if (!result && includeExpired) {
    // No active sub — return the last expired/cancelled one for display purposes
    const lastSub = await (await import('./subscription.model')).Subscription.findOne(
      { tenantId, status: { $in: ['expired', 'cancelled'] } },
      null,
      { sort: { endDate: -1 } }
    ).populate('packageId');

    if (lastSub) {
      return ApiResponse.sendSuccess(res, 200, 'My subscription retrieved successfully', {
        ...lastSub.toObject(),
        status: 'expired', // normalise to expired regardless of cancelled
      });
    }
  }

  ApiResponse.sendSuccess(res, 200, 'My subscription retrieved successfully', result);
});

const requestPackage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const trackingContext = {
    clientIpAddress: getClientIp(req),
    clientUserAgent: (req.headers['user-agent'] as string) || '',
    fbp: req.body?.fbp,
    fbc: req.body?.fbc,
    eventSourceUrl: req.body?.eventSourceUrl || (req.headers.referer as string) || '',
  };
  const result = await SubscriptionService.requestPackage(
    tenantId,
    req.body.packageId,
    req.body.activationType,
    trackingContext
  );
  ApiResponse.sendSuccess(res, 201, 'Package requested successfully', result);
});

const approveSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.approveSubscription(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Subscription approved successfully', result);
});

const rejectSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.rejectSubscription(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Subscription rejected successfully', result);
});

const getAllSubscriptions = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.getAllSubscriptions(req.query);
  ApiResponse.sendSuccess(res, 200, 'All subscriptions retrieved successfully', result.data, result.meta);
});

const updateSubscription = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.updateSubscription(req.params.id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Subscription updated successfully', result);
});

const deleteSubscription = asyncHandler(async (req: Request, res: Response) => {
  await SubscriptionService.deleteSubscription(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Subscription deleted successfully', null);
});

const purchaseAddon = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await SubscriptionService.purchaseAddon(tenantId, req.body);
  ApiResponse.sendSuccess(res, 200, 'Addon purchased successfully', result);
});

const getAllAddonRequests = asyncHandler(async (req: Request, res: Response) => {
  const result = await SubscriptionService.getAllAddonRequests(req.query);
  ApiResponse.sendSuccess(res, 200, 'All addon requests retrieved successfully', result);
});

const approveAddonRequest = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.approveAddonRequest(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon request approved successfully', result);
});

const deactivateAddonRequest = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.deactivateAddonRequest(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon deactivated / put on hold successfully', result);
});

const reactivateAddonRequest = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.reactivateAddonRequest(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon reactivated successfully', result);
});

const extendAddonLimit = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const extraLimit = req.body?.extraLimit || req.body?.limit;
  const result = await SubscriptionService.extendAddonLimit(subscriptionId as string, addonId as string, extraLimit);
  ApiResponse.sendSuccess(res, 200, 'Addon limit extended successfully', result);
});

const terminateAddonRequest = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.terminateAddonRequest(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon terminated successfully', result);
});

const rejectAddonRequest = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.rejectAddonRequest(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon request rejected successfully', result);
});

const removeAddon = asyncHandler(async (req: Request, res: Response) => {
  const { subscriptionId, addonId } = req.params;
  const result = await SubscriptionService.removeAddon(subscriptionId as string, addonId as string);
  ApiResponse.sendSuccess(res, 200, 'Addon removed successfully', result);
});

const activateEarly = asyncHandler(async (req: Request, res: Response) => {
  const callerRole = (req as any).user?.role;
  const tenantId = callerRole === 'super_admin' ? (req.body.tenantId || (req as any).user?.tenantId) : (req as any).user?.tenantId;
  const result = await SubscriptionService.activateEarly(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Upcoming subscription activated immediately with zero time gap', result);
});

const activateEarlyById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const sub = await Subscription.findById(id);
  if (!sub) {
    return ApiResponse.sendError(res, 404, 'Subscription not found');
  }
  const result = await SubscriptionService.activateEarly(sub.tenantId.toString(), id);
  ApiResponse.sendSuccess(res, 200, 'Subscription activated immediately with zero time gap', result);
});

const triggerExpiryReminders = asyncHandler(async (req: Request, res: Response) => {
  const { checkAndSendExpiryWarnings } = require('./subscription.cron');
  const result = await checkAndSendExpiryWarnings();
  ApiResponse.sendSuccess(res, 200, 'Subscription expiry scan completed successfully', result);
});


const sendManualExpiryWarning = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const sub = await Subscription.findById(id).populate('packageId').populate('tenantId');
  if (!sub) {
    return ApiResponse.sendError(res, 404, 'Subscription not found');
  }

  const tenant = sub.tenantId as any;
  if (!tenant) {
    return ApiResponse.sendError(res, 400, 'Associated tenant not found for this subscription');
  }

  let ownerUser: any = null;
  if (tenant.ownerId) {
    ownerUser = await User.findById(tenant.ownerId);
  }

  const recipientEmail = ownerUser?.email || tenant.contactEmail;
  if (!recipientEmail) {
    return ApiResponse.sendError(res, 400, `No email address found on file for store "${tenant.name || 'Store'}"`);
  }

  const storeName = tenant.name || 'আপনার অনলাইন স্টোর';
  const ownerName = ownerUser?.name || tenant.name || 'সম্মানিত মার্চেন্ট';
  const isTrial = Boolean(sub.isTrial);
  const planName = isTrial ? 'ফ্রি ট্রায়াল' : (sub.packageId as any)?.name || 'পেইড প্ল্যান';

  const now = new Date();
  const endDate = sub.endDate ? new Date(sub.endDate) : now;
  const diffMs = endDate.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const daysRemaining = diffMs > 0 ? Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24))) : 0;

  const renewalUrl = `${config.app.frontendUrl || 'https://merchant.masheco.com'}/dashboard/subscription`;

  const daysText = daysRemaining === 1 ? '১ দিন' : `${daysRemaining} দিন`;
  const subject = diffMs > 0
    ? (isTrial
        ? `⚠️ আপনার MASH ECO ফ্রি ট্রায়ালের মেয়াদ আর মাত্র ${daysText} বাকি!`
        : `⚠️ আপনার MASH ECO সাবস্ক্রিপশনের মেয়াদ আর মাত্র ${daysText} বাকি!`)
    : (isTrial
        ? `⚠️ আপনার MASH ECO ফ্রি ট্রায়ালের মেয়াদ শেষ হয়ে গেছে!`
        : `⚠️ আপনার MASH ECO সাবস্ক্রিপশনের মেয়াদ শেষ হয়ে গেছে!`);

  const html = subscriptionExpiryReminderTemplate({
    storeName,
    ownerName,
    planName,
    isTrial,
    expiryDate: sub.endDate,
    daysRemaining: Math.max(1, daysRemaining),
    renewalUrl,
  });

  // 1. Send Email to merchant
  await sendEmail(recipientEmail, subject, html);

  // 2. Create In-App Notification in Merchant Dashboard
  if (tenant.ownerId) {
    try {
      await notificationService.createNotification(
        tenant.ownerId,
        'SUBSCRIPTION_EXPIRING_SOON',
        isTrial ? 'ফ্রি ট্রায়াল শেষের সতর্কতা' : 'সাবস্ক্রিপশনের মেয়াদ শেষের সতর্কতা',
        diffMs > 0
          ? `আপনার "${storeName}" স্টোরের ${isTrial ? 'ফ্রি ট্রায়ালের' : 'সাবস্ক্রিপশনের'} মেয়াদ আর মাত্র ${daysRemaining} দিন বাকি আছে। মেয়াদ শেষ হওয়ার আগেই রিনিউ সম্পন্ন করুন।`
          : `আপনার "${storeName}" স্টোরের ${isTrial ? 'ফ্রি ট্রায়ালের' : 'সাবস্ক্রিপশনের'} মেয়াদ শেষ হয়ে গেছে। স্টোর সচল রাখতে এখনই রিনিউ সম্পন্ন করুন।`,
        sub._id,
        tenant._id
      );
    } catch (notifErr) {
      console.error('[sendManualExpiryWarning] Failed to send in-app notification:', notifErr);
    }
  }

  // 3. Mark Warning as Sent with exact timestamp
  sub.expiryWarningSent = true;
  sub.expiryWarningSentAt = new Date();
  await sub.save();

  ApiResponse.sendSuccess(res, 200, `Warning notification & email sent successfully to ${recipientEmail}`, {
    recipientEmail,
    sentAt: sub.expiryWarningSentAt,
    daysRemaining,
    diffHours,
    isTrial,
    storeName,
    subscriptionId: sub._id,
  });
});

export const SubscriptionController = {
  assignPackage,
  getTenantSubscription,
  getMySubscription,
  requestPackage,
  approveSubscription,
  rejectSubscription,
  updateSubscription,
  deleteSubscription,
  getAllSubscriptions,
  purchaseAddon,
  getAllAddonRequests,
  approveAddonRequest,
  deactivateAddonRequest,
  reactivateAddonRequest,
  extendAddonLimit,
  terminateAddonRequest,
  rejectAddonRequest,
  removeAddon,
  activateEarly,
  activateEarlyById,
  triggerExpiryReminders,
  sendManualExpiryWarning
};
