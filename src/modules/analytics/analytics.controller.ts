import { Request, Response } from 'express';
import { Order } from '../order/order.model';
import { Customer } from '../customer/customer.model';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const days = parseInt(req.query.days as string) || 30;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Totals based on timeframe
  const totalOrders = await Order.countDocuments({ tenantId, createdAt: { $gte: startDate } });
  
  // Total customers can just be all-time for the tenant, or created in timeframe
  const totalCustomers = await Customer.countDocuments({ tenantId });
  
  const mongoose = require('mongoose');
  const revenueResult = await Order.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(tenantId), createdAt: { $gte: startDate }, status: { $regex: new RegExp('^delivered$', 'i') } } },
    { $group: { _id: null, totalRevenue: { $sum: '$totalPrice' } } }
  ]);
  const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

  // Compute chart data dynamically
  const orders = await Order.find({ tenantId, createdAt: { $gte: startDate } }).sort({ createdAt: 1 });
  
  const chartDataMap: Record<string, { name: string; revenue: number; orders: number }> = {};
  
  orders.forEach(order => {
    let dateStr;
    if (days <= 30) {
      dateStr = new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      dateStr = new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    let currentData = chartDataMap[dateStr];
    if (!currentData) {
      currentData = { name: dateStr, revenue: 0, orders: 0 };
      chartDataMap[dateStr] = currentData;
    }
    
    currentData.orders += 1;
    if (order.status?.toLowerCase() === 'delivered') {
      currentData.revenue += order.totalPrice;
    }
  });

  const chartData = Object.values(chartDataMap);

  ApiResponse.sendSuccess(res, 200, 'Dashboard stats retrieved', {
    totalOrders,
    totalCustomers,
    totalRevenue,
    chartData,
    conversionRate: 3.2 // Static for now, could be calculated based on site visits if tracked
  });
});

const getDashboardSummary = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const days = parseInt(req.query.days as string) || 7;
  const mongoose = require('mongoose');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { Tenant } = require('../tenant/tenant.model');
  const { Subscription } = require('../subscription/subscription.model');
  const { Product } = require('../product/product.model');
  const { Category } = require('../category/category.model');

  // Run all independent queries in parallel using Promise.all
  const [
    storeInfo,
    totalOrders,
    totalCustomers,
    revenueResult,
    recentOrders,
    subscription,
    totalProds,
    draftProds,
    topProducts,
    allCats
  ] = await Promise.all([
    Tenant.findById(tenantId).select('name slug'),
    Order.countDocuments({ tenantId, createdAt: { $gte: startDate } }),
    Customer.countDocuments({ tenantId }),
    Order.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(tenantId), createdAt: { $gte: startDate }, status: { $regex: new RegExp('^delivered$', 'i') } } },
      { $group: { _id: null, totalRevenue: { $sum: '$totalPrice' } } }
    ]),
    Order.find({ tenantId }).sort({ createdAt: -1 }).limit(5),
    Subscription.findOne({ tenantId, status: 'active' }).populate('packageId'),
    Product.countDocuments({ tenantId }),
    Product.countDocuments({ tenantId, status: 'DRAFT' }),
    Product.find({ tenantId }).sort({ salesCount: -1 }).limit(4).lean(),
    Category.find({ tenantId }).select('status')
  ]);

  const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

  // Calculate category stats
  const categoryStats = {
    total: allCats.length,
    active: allCats.filter((c: any) => c.status !== 'INACTIVE').length,
    inactive: allCats.filter((c: any) => c.status === 'INACTIVE').length,
  };

  const productStats = {
    total: totalProds,
    active: totalProds - draftProds,
    inactive: draftProds
  };

  // Compile final result
  const summary = {
    store: storeInfo,
    stats: {
      totalRevenue,
      totalOrders,
      totalCustomers,
      conversionRate: 3.2 // static for now
    },
    recentOrders,
    subscription,
    productStats,
    topProducts,
    categoryStats
  };

  ApiResponse.sendSuccess(res, 200, 'Dashboard summary retrieved', summary);
});

const getSuperAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const { Tenant } = require('../tenant/tenant.model');
  const { Subscription } = require('../subscription/subscription.model');
  const os = require('os');

  const totalTenants = await Tenant.countDocuments();
  const activeSubscriptions = await Subscription.find({ status: 'active' }).populate('packageId');
  
  const activePackages = activeSubscriptions.length;
  const monthlyMRR = activeSubscriptions.reduce((acc: number, sub: any) => {
    return acc + (sub.packageId?.price || 0);
  }, 0);

  const loadAvg = os.loadavg()[0];
  const systemLoad = Math.min(Math.round(loadAvg * 10), 100);

  // Revenue chart data (mocked historically, based on current MRR for now)
  const chartData = [
    { name: 'Jan', revenue: monthlyMRR * 0.7 },
    { name: 'Feb', revenue: monthlyMRR * 0.75 },
    { name: 'Mar', revenue: monthlyMRR * 0.8 },
    { name: 'Apr', revenue: monthlyMRR * 0.9 },
    { name: 'May', revenue: monthlyMRR * 0.95 },
    { name: 'Jun', revenue: monthlyMRR },
    { name: 'Jul', revenue: monthlyMRR },
  ];

  ApiResponse.sendSuccess(res, 200, 'Super admin stats retrieved', {
    totalTenants,
    activePackages,
    monthlyMRR,
    systemLoad: `${systemLoad}%`,
    chartData
  });
});

export const AnalyticsController = {
  getDashboardStats,
  getSuperAdminStats,
  getDashboardSummary,
};
