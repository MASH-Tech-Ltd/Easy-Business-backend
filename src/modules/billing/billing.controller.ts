import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { Tenant } from '../tenant/tenant.model';
import { Subscription } from '../subscription/subscription.model';

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

export const BillingController = {
  getBillingOverview,
};
