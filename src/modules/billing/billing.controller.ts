import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const getBillingOverview = asyncHandler(async (req: Request, res: Response) => {
  // Simulated Billing stats
  const data = {
    mrr: '45,200',
    activeSubscriptions: '842',
    pendingInvoices: '12'
  };
  ApiResponse.sendSuccess(res, 200, 'Billing stats retrieved', data);
});

export const BillingController = {
  getBillingOverview,
};
