import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';
import { BillingService } from './billing.service';

const getBillingOverview = asyncHandler(async (req: Request, res: Response) => {
  const [totalMerchants, activeSubscriptions, pendingInvoices, allSubs] = await Promise.all([
    Tenant.countDocuments(),
    Subscription.countDocuments({ status: 'active' }),
    Subscription.countDocuments({ status: 'pending' }),
    Subscription.find({ isTrial: false, status: { $in: ['active', 'expired'] } }).populate('packageId')
  ]);

  let totalRevenue = 0;
  let thisMonthRevenue = 0;
  let mrr = 0;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  allSubs.forEach((sub: any) => {
    if (sub.packageId && sub.packageId.price) {
      const price = sub.packageId.price;
      
      totalRevenue += price;

      const subStart = new Date(sub.startDate || sub.createdAt);
      if (subStart.getMonth() === currentMonth && subStart.getFullYear() === currentYear) {
        thisMonthRevenue += price;
      }

      if (sub.status === 'active') {
         if (sub.packageId.billingCycle === 'yearly') {
           mrr += (price / 12);
         } else {
           mrr += price;
         }
      }
    }
  });

  const data = {
    mrr: Math.round(mrr),
    totalRevenue: Math.round(totalRevenue),
    thisMonthRevenue: Math.round(thisMonthRevenue),
    totalMerchants,
    activeSubscriptions,
    pendingInvoices
  };
  ApiResponse.sendSuccess(res, 200, 'Billing stats retrieved', data);
});

const getPlatformPaymentSettings = asyncHandler(async (req: Request, res: Response) => {
  const result = await BillingService.getPlatformPaymentSettings();
  ApiResponse.sendSuccess(res, 200, 'Platform payment settings retrieved', result);
});

const updatePlatformPaymentSettings = asyncHandler(async (req: Request, res: Response) => {
  const result = await BillingService.updatePlatformPaymentSettings(req.body);
  ApiResponse.sendSuccess(res, 200, 'Platform payment settings updated', result);
});

const submitPaymentProof = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await BillingService.submitPaymentProof(tenantId, req.body);
  ApiResponse.sendSuccess(res, 201, 'Payment proof submitted successfully', result);
});

const getMyPaymentSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const result = await BillingService.getMyPaymentSubmissions(tenantId);
  ApiResponse.sendSuccess(res, 200, 'Payment submissions retrieved', result);
});

const updateMyPaymentSubmission = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const { id } = req.params;
  const result = await BillingService.updateMyPaymentSubmission(tenantId, id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Payment submission updated successfully', result);
});

const getAllPaymentSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const result = await BillingService.getAllPaymentSubmissions();
  ApiResponse.sendSuccess(res, 200, 'All payment submissions retrieved', result);
});

const verifyPaymentSubmission = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, adminFeedback } = req.body;
  const result = await BillingService.verifyPaymentSubmission(id as string, status, adminFeedback);
  ApiResponse.sendSuccess(res, 200, `Payment submission ${status}`, result);
});

export const BillingController = {
  getBillingOverview,
  getPlatformPaymentSettings,
  updatePlatformPaymentSettings,
  submitPaymentProof,
  getMyPaymentSubmissions,
  updateMyPaymentSubmission,
  getAllPaymentSubmissions,
  verifyPaymentSubmission,
};

