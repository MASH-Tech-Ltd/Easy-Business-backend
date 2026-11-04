import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp } from '../../utils/ipHelper';
import { AffiliateService } from './services/affiliate.service';
import { AffiliateReferralService } from './services/referral.service';
import { AffiliateCommissionService } from './services/commission.service';
import { AffiliateWithdrawalService } from './services/withdrawal.service';
import { AffiliateAdminService } from './services/affiliate-admin.service';
import { notificationService } from '../notification/notification.service';

// ─────────────────────────────────────────────────────────────────────────────
// Public & Auth Endpoints
// ─────────────────────────────────────────────────────────────────────────────

const getPublicConfig = asyncHandler(async (_req: Request, res: Response) => {
  const result = await AffiliateService.getPublicConfig();
  ApiResponse.sendSuccess(res, 200, 'Affiliate program configuration retrieved', result);
});

const validateCode = asyncHandler(async (req: Request, res: Response) => {
  const code = (req.params.code as string) || '';
  const result = await AffiliateReferralService.validateAffiliateCode(code);
  if (!result) {
    return ApiResponse.sendError(res, 404, 'Invalid affiliate referral code');
  }
  ApiResponse.sendSuccess(res, 200, 'Affiliate referral code is valid', result);
});

const trackClick = asyncHandler(async (req: Request, res: Response) => {
  const code = (req.body?.code as string) || '';
  const result = await AffiliateReferralService.trackReferralClick(code);
  ApiResponse.sendSuccess(res, 200, 'Referral click processed', result);
});

const register = asyncHandler(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const result = await AffiliateService.registerAffiliate({
    ...req.body,
    ipAddress,
  });

  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days persistent session
    path: '/',
  };

  res.cookie('_affiliate_x_tkn', result.accessToken, cookieOptions);
  res.cookie('_affiliate_r_tkn', result.refreshToken, cookieOptions);

  ApiResponse.sendSuccess(res, 201, 'Affiliate Partner account created successfully', result);
});

const login = asyncHandler(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const result = await AffiliateService.loginAffiliate({
    email: req.body.email,
    password: req.body.password,
    ipAddress,
  });

  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days persistent session
    path: '/',
  };

  res.cookie('_affiliate_x_tkn', result.accessToken, cookieOptions);
  res.cookie('_affiliate_r_tkn', result.refreshToken, cookieOptions);

  ApiResponse.sendSuccess(res, 200, 'Logged in successfully', result);
});

const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const token =
    req.cookies?._affiliate_r_tkn ||
    req.body?.refreshToken ||
    req.cookies?.refreshToken;

  const result = await AffiliateService.refreshToken(token);

  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days persistent session
    path: '/',
  };

  res.cookie('_affiliate_x_tkn', result.accessToken, cookieOptions);
  res.cookie('_affiliate_r_tkn', result.refreshToken, cookieOptions);

  ApiResponse.sendSuccess(res, 200, 'Affiliate token refreshed successfully', {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user,
    affiliate: result.affiliate,
  });
});

const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie('_affiliate_x_tkn', { path: '/' });
  res.clearCookie('_affiliate_r_tkn', { path: '/' });
  ApiResponse.sendSuccess(res, 200, 'Logged out successfully', null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Protected Affiliate Partner Endpoints
// ─────────────────────────────────────────────────────────────────────────────

const getMe = asyncHandler(async (req: Request, res: Response) => {
  const result = await AffiliateService.getMe(req.user._id);
  ApiResponse.sendSuccess(res, 200, 'Affiliate partner profile retrieved', result);
});

const getOverview = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateService.getOverview(affiliate._id, req.query);
  ApiResponse.sendSuccess(res, 200, 'Affiliate overview retrieved', result);
});

const getReferrals = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateReferralService.getAffiliateReferrals(affiliate._id, req.query);
  ApiResponse.sendSuccess(res, 200, 'Affiliate referrals retrieved', result);
});

const getReferralById = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateReferralService.getAffiliateReferralById(affiliate._id, req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Referred merchant details retrieved', result);
});

const getCommissions = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateCommissionService.getAffiliateCommissions(affiliate._id, req.query);
  ApiResponse.sendSuccess(res, 200, 'Affiliate commissions retrieved', result);
});

const getLedger = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateService.getLedgerTransactions(affiliate._id, req.query);
  ApiResponse.sendSuccess(res, 200, 'Affiliate ledger transactions retrieved', result);
});

const getWithdrawals = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateWithdrawalService.getAffiliateWithdrawals(affiliate._id, req.query);
  ApiResponse.sendSuccess(res, 200, 'Affiliate withdrawals retrieved', result);
});

const requestWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const ipAddress = getClientIp(req);
  const result = await AffiliateWithdrawalService.requestWithdrawal({
    affiliateId: affiliate._id,
    userId: req.user._id,
    amount: Number(req.body.amount),
    paymentMethod: req.body.paymentMethod,
    paymentDetails: req.body.paymentDetails,
    ipAddress,
  });
  ApiResponse.sendSuccess(res, 201, 'Withdrawal request submitted successfully', result);
});

const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const result = await AffiliateService.updateProfile(req.user._id, req.body, ipAddress);
  ApiResponse.sendSuccess(res, 200, 'Profile updated successfully', result);
});

const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const result = await AffiliateService.changePassword(req.user._id, req.body, ipAddress);
  ApiResponse.sendSuccess(res, 200, 'Password updated successfully', result);
});

const getPaymentMethods = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  ApiResponse.sendSuccess(
    res,
    200,
    'Payment methods retrieved',
    affiliate.paymentMethods || []
  );
});

const updatePaymentMethods = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const ipAddress = getClientIp(req);
  const result = await AffiliateService.updatePaymentMethods(
    affiliate._id,
    req.user._id,
    req.body.paymentMethods,
    ipAddress
  );
  ApiResponse.sendSuccess(res, 200, 'Payment methods updated successfully', result);
});

// ─────────────────────────────────────────────────────────────────────────────
// Protected Super Admin Endpoints
// ─────────────────────────────────────────────────────────────────────────────

const getAdminOverview = asyncHandler(async (_req: Request, res: Response) => {
  const result = await AffiliateAdminService.getAdminOverviewStats();
  ApiResponse.sendSuccess(res, 200, 'Admin affiliate overview stats retrieved', result);
});

const getAdminAffiliatesList = asyncHandler(async (req: Request, res: Response) => {
  const result = await AffiliateAdminService.getAdminAffiliatesList(req.query);
  ApiResponse.sendSuccess(res, 200, 'Affiliates list retrieved', result);
});

const getAdminAffiliateDetail = asyncHandler(async (req: Request, res: Response) => {
  const result = await AffiliateAdminService.getAdminAffiliateDetail(
    req.params.id as string,
    req.query
  );
  ApiResponse.sendSuccess(res, 200, 'Affiliate details retrieved', result);
});

const updateAffiliateStatus = asyncHandler(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const result = await AffiliateAdminService.updateAffiliateStatus({
    affiliateId: req.params.id as string,
    status: req.body.status,
    reason: req.body.reason,
    commissionConfigOverride: req.body.commissionConfigOverride,
    adminActorId: req.user._id,
    ipAddress,
  });
  ApiResponse.sendSuccess(res, 200, 'Affiliate account status updated', result);
});

const getAdminCommissionsList = asyncHandler(async (req: Request, res: Response) => {
  const result = await AffiliateAdminService.getAdminCommissionsList(req.query);
  ApiResponse.sendSuccess(res, 200, 'Admin commissions list retrieved', result);
});

const updateCommissionStatus = asyncHandler(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const result = await AffiliateAdminService.updateCommissionStatus({
    commissionId: req.params.commissionId as string,
    status: req.body.status,
    reason: req.body.reason,
    adminActorId: req.user._id,
    ipAddress,
  });
  ApiResponse.sendSuccess(res, 200, 'Commission status updated', result);
});

const getAdminWithdrawalsList = asyncHandler(async (req: Request, res: Response) => {
  const result = await AffiliateAdminService.getAdminWithdrawalsList(req.query);
  ApiResponse.sendSuccess(res, 200, 'Admin withdrawals list retrieved', result);
});

const processAffiliateWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const result = await AffiliateAdminService.processAffiliateWithdrawal({
    withdrawalId: req.params.withdrawalId as string,
    status: req.body.status,
    transactionReference: req.body.transactionReference,
    rejectionReason: req.body.rejectionReason,
    adminNotes: req.body.adminNotes,
    adminActorId: req.user._id,
    ipAddress,
  });
  ApiResponse.sendSuccess(res, 200, 'Withdrawal request processed successfully', result);
});

const getAdminAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const result = await AffiliateAdminService.getAdminAuditLogs(req.query);
  ApiResponse.sendSuccess(res, 200, 'Affiliate audit logs retrieved', result);
});

const getSupportTickets = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateService.getSupportTickets(affiliate._id, req.user._id);
  ApiResponse.sendSuccess(res, 200, 'Support tickets retrieved', result);
});

const createSupportTicket = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateService.createSupportTicket({
    affiliateId: affiliate._id,
    userId: req.user._id,
    subject: req.body.subject,
    category: req.body.category,
    priority: req.body.priority,
    message: req.body.message,
  });
  ApiResponse.sendSuccess(res, 201, 'Support ticket created successfully', result);
});

const getSupportTicketDetail = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateService.getSupportTicketDetail(
    req.params.id as string,
    affiliate._id,
    req.user._id
  );
  ApiResponse.sendSuccess(res, 200, 'Support ticket details retrieved', result);
});

const replySupportTicket = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateService.replySupportTicket({
    ticketId: req.params.id as string,
    affiliateId: affiliate._id,
    userId: req.user._id,
    message: req.body.message,
  });
  ApiResponse.sendSuccess(res, 200, 'Reply sent successfully', result);
});

const updateSupportTicketStatus = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = (req as any).affiliate;
  const result = await AffiliateService.updateSupportTicketStatus({
    ticketId: req.params.id as string,
    affiliateId: affiliate._id,
    userId: req.user._id,
    status: (req.body.status || 'RESOLVED').toUpperCase(),
  });
  ApiResponse.sendSuccess(res, 200, 'Ticket status updated', result);
});


const getMyNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user._id;
  const data = await notificationService.getUserNotifications(userId, req.query);
  ApiResponse.sendSuccess(res, 200, 'Notifications retrieved', data);
});

const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req as any).user._id;
  const notification = await notificationService.markAsRead(id as string, userId.toString());
  if (!notification) {
    return ApiResponse.sendError(res, 404, 'Notification not found or not authorized');
  }
  ApiResponse.sendSuccess(res, 200, 'Notification marked as read', notification);
});

const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user._id;
  await notificationService.markAllAsRead(userId);
  ApiResponse.sendSuccess(res, 200, 'All notifications marked as read');
});

export const AffiliateController = {
  getPublicConfig,
  validateCode,
  trackClick,
  register,
  login,
  refreshToken,
  logout,
  getMe,
  getOverview,
  getReferrals,
  getReferralById,
  getCommissions,
  getLedger,
  getWithdrawals,
  requestWithdrawal,
  updateProfile,
  changePassword,
  getPaymentMethods,
  updatePaymentMethods,
  getSupportTickets,
  createSupportTicket,
  getSupportTicketDetail,
  replySupportTicket,
  updateSupportTicketStatus,
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getAdminOverview,
  getAdminAffiliatesList,
  getAdminAffiliateDetail,
  updateAffiliateStatus,
  getAdminCommissionsList,
  updateCommissionStatus,
  getAdminWithdrawalsList,
  processAffiliateWithdrawal,
  getAdminAuditLogs,
};

