import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';
import { BillingService } from './billing.service';

const getBillingOverview = asyncHandler(async (req: Request, res: Response) => {
  const { year, month, startDate, endDate } = req.query as {
    year?: string;
    month?: string;
    startDate?: string;
    endDate?: string;
  };

  const [totalMerchants, activeSubscriptions, pendingInvoices, allSubs] = await Promise.all([
    Tenant.countDocuments(),
    Subscription.countDocuments({ status: 'active' }),
    Subscription.countDocuments({ status: 'pending' }),
    Subscription.find({ isTrial: false, status: { $in: ['active', 'expired', 'cancelled'] } }).populate('packageId'),
  ]);

  let totalRevenue = 0;
  let grossRevenue = 0;
  let totalDiscounts = 0;
  let thisMonthRevenue = 0;
  let thisYearRevenue = 0;
  let mrr = 0;

  let filteredRevenue = 0;
  let filteredGrossRevenue = 0;
  let filteredDiscounts = 0;
  let filteredCount = 0;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let filterStart: Date | null = null;
  let filterEnd: Date | null = null;
  let filteredPeriodLabel = '';

  if (startDate && endDate) {
    filterStart = new Date(startDate);
    filterStart.setHours(0, 0, 0, 0);
    filterEnd = new Date(endDate);
    filterEnd.setHours(23, 59, 59, 999);
    filteredPeriodLabel = `${startDate} to ${endDate}`;
  } else if (year && year !== 'all') {
    const numYear = parseInt(year);
    if (month && month !== 'all') {
      const numMonth = parseInt(month);
      filterStart = new Date(numYear, numMonth - 1, 1, 0, 0, 0, 0);
      filterEnd = new Date(numYear, numMonth, 0, 23, 59, 59, 999);
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      filteredPeriodLabel = `${monthNames[numMonth - 1]} ${numYear}`;
    } else {
      filterStart = new Date(numYear, 0, 1, 0, 0, 0, 0);
      filterEnd = new Date(numYear, 11, 31, 23, 59, 59, 999);
      filteredPeriodLabel = `Year ${numYear}`;
    }
  }

  allSubs.forEach((sub: any) => {
    const pkg = sub.packageId;
    if (!pkg) return;

    const pkgPrice = pkg.price || 0;
    const grossPrice = Number(sub.originalPrice ?? pkgPrice);
    const netPrice = Number(sub.paidAmount ?? grossPrice);
    const discount = Math.max(0, grossPrice - netPrice);

    // Only count as revenue if the net price was paid (> 0 or status active/expired)
    if (netPrice > 0 || sub.status === 'active' || sub.status === 'expired') {
      totalRevenue += netPrice;
      grossRevenue += grossPrice;
      totalDiscounts += discount;

      const subDate = new Date(sub.startDate || sub.createdAt);
      if (subDate.getMonth() === currentMonth && subDate.getFullYear() === currentYear) {
        thisMonthRevenue += netPrice;
      }
      if (subDate.getFullYear() === currentYear) {
        thisYearRevenue += netPrice;
      }

      if (filterStart && filterEnd && subDate >= filterStart && subDate <= filterEnd) {
        filteredRevenue += netPrice;
        filteredGrossRevenue += grossPrice;
        filteredDiscounts += discount;
        filteredCount += 1;
      }
    }

    if (
      sub.status === 'active' &&
      sub.startDate &&
      new Date(sub.startDate) <= now &&
      sub.endDate &&
      new Date(sub.endDate) >= now
    ) {
      if (pkg.billingCycle === 'yearly') {
        mrr += netPrice / 12;
      } else {
        mrr += netPrice;
      }
    }
  });

  const data = {
    mrr: Math.round(mrr),
    totalRevenue: Math.round(totalRevenue),
    grossRevenue: Math.round(grossRevenue),
    totalDiscounts: Math.round(totalDiscounts),
    thisMonthRevenue: Math.round(thisMonthRevenue),
    thisYearRevenue: Math.round(thisYearRevenue),
    totalMerchants,
    activeSubscriptions,
    pendingInvoices,
    hasFilter: Boolean(filterStart && filterEnd),
    filteredPeriodLabel,
    filteredRevenue: Math.round(filteredRevenue),
    filteredGrossRevenue: Math.round(filteredGrossRevenue),
    filteredDiscounts: Math.round(filteredDiscounts),
    filteredCount,
  };
  ApiResponse.sendSuccess(res, 200, 'Billing stats retrieved', data);
});

const getRevenueReport = asyncHandler(async (req: Request, res: Response) => {
  const { type, year, month, startDate, endDate, status } = req.query as any;

  let filterStart: Date | null = null;
  let filterEnd: Date | null = null;
  let periodLabel = 'All Time';

  if (type === 'custom' && startDate && endDate) {
    filterStart = new Date(startDate);
    filterStart.setHours(0, 0, 0, 0);
    filterEnd = new Date(endDate);
    filterEnd.setHours(23, 59, 59, 999);
    periodLabel = `${startDate} to ${endDate}`;
  } else if (type === 'monthly' && year && month && month !== 'all' && year !== 'all') {
    const numYear = parseInt(year);
    const numMonth = parseInt(month);
    filterStart = new Date(numYear, numMonth - 1, 1, 0, 0, 0, 0);
    filterEnd = new Date(numYear, numMonth, 0, 23, 59, 59, 999);
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    periodLabel = `${monthNames[numMonth - 1]} ${numYear}`;
  } else if (type === 'yearly' && year && year !== 'all') {
    const numYear = parseInt(year);
    filterStart = new Date(numYear, 0, 1, 0, 0, 0, 0);
    filterEnd = new Date(numYear, 11, 31, 23, 59, 59, 999);
    periodLabel = `Year ${numYear}`;
  } else if (startDate && endDate) {
    filterStart = new Date(startDate);
    filterStart.setHours(0, 0, 0, 0);
    filterEnd = new Date(endDate);
    filterEnd.setHours(23, 59, 59, 999);
    periodLabel = `${startDate} to ${endDate}`;
  } else if (year && year !== 'all') {
    const numYear = parseInt(year);
    if (month && month !== 'all') {
      const numMonth = parseInt(month);
      filterStart = new Date(numYear, numMonth - 1, 1, 0, 0, 0, 0);
      filterEnd = new Date(numYear, numMonth, 0, 23, 59, 59, 999);
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      periodLabel = `${monthNames[numMonth - 1]} ${numYear}`;
    } else {
      filterStart = new Date(numYear, 0, 1, 0, 0, 0, 0);
      filterEnd = new Date(numYear, 11, 31, 23, 59, 59, 999);
      periodLabel = `Year ${numYear}`;
    }
  }

  const filter: any = { isTrial: false };
  if (status && status !== 'all') {
    filter.status = status;
  } else {
    filter.status = { $in: ['active', 'expired', 'cancelled'] };
  }

  if (filterStart && filterEnd) {
    filter.$or = [
      { startDate: { $gte: filterStart, $lte: filterEnd } },
      { createdAt: { $gte: filterStart, $lte: filterEnd } },
    ];
  }

  const subscriptions = await Subscription.find(filter)
    .populate({
      path: 'tenantId',
      populate: { path: 'ownerId', select: 'name email' },
    })
    .populate('packageId')
    .sort({ createdAt: -1 })
    .lean();

  let totalRevenue = 0;
  let totalGross = 0;
  let totalDiscounts = 0;

  const items = subscriptions.map((sub: any, idx: number) => {
    const pkg = sub.packageId || {};
    const tenant = sub.tenantId || {};
    const pkgPrice = pkg.price || 0;
    const grossPrice = Number(sub.originalPrice ?? pkgPrice);
    const netPrice = Number(sub.paidAmount ?? grossPrice);
    const discount = Math.max(0, grossPrice - netPrice);

    totalRevenue += netPrice;
    totalGross += grossPrice;
    totalDiscounts += discount;

    return {
      sl: idx + 1,
      _id: sub._id,
      date: sub.startDate || sub.createdAt,
      tenantName: tenant.name || 'Unknown Store',
      tenantDomain: tenant.domain || 'N/A',
      tenantEmail: tenant.contactEmail || tenant.ownerId?.email || 'N/A',
      packageName: pkg.name || 'Unknown Package',
      billingCycle: pkg.billingCycle || 'monthly',
      originalPrice: grossPrice,
      discountAmount: discount,
      discountReason: sub.discountApplied?.reason || (discount > 0 ? 'Discount' : '-'),
      paidAmount: netPrice,
      status: sub.status,
      startDate: sub.startDate,
      endDate: sub.endDate,
    };
  });

  const reportData = {
    summary: {
      reportType: type || 'all',
      periodLabel,
      totalRevenue: Math.round(totalRevenue),
      totalGross: Math.round(totalGross),
      totalDiscounts: Math.round(totalDiscounts),
      totalTransactions: items.length,
      generatedAt: new Date().toISOString(),
      currency: 'BDT',
    },
    items,
  };

  ApiResponse.sendSuccess(res, 200, 'Revenue report retrieved', reportData);
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
  const result = await BillingService.getAllPaymentSubmissions(req.query);
  ApiResponse.sendSuccess(res, 200, 'All payment submissions retrieved successfully', result);
});

const verifyPaymentSubmission = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, adminFeedback } = req.body;
  const result = await BillingService.verifyPaymentSubmission(id as string, status, adminFeedback);
  ApiResponse.sendSuccess(res, 200, `Payment submission ${status}`, result);
});

const getPaymentProofsReport = asyncHandler(async (req: Request, res: Response) => {
  const result = await BillingService.getPaymentProofsReport(req.query);
  ApiResponse.sendSuccess(res, 200, 'Payment proofs report retrieved', result);
});

const deletePaymentSubmission = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await BillingService.deletePaymentSubmission(id as string);
  ApiResponse.sendSuccess(res, 200, 'Payment history deleted successfully', result);
});

const sendPaymentConfirmationEmail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await BillingService.sendPaymentConfirmationEmail(id as string);
  ApiResponse.sendSuccess(res, 200, 'Payment confirmation email sent successfully', result);
});

export const BillingController = {
  getBillingOverview,
  getRevenueReport,
  getPaymentProofsReport,
  getPlatformPaymentSettings,
  updatePlatformPaymentSettings,
  submitPaymentProof,
  getMyPaymentSubmissions,
  updateMyPaymentSubmission,
  getAllPaymentSubmissions,
  verifyPaymentSubmission,
  deletePaymentSubmission,
  sendPaymentConfirmationEmail,
};


