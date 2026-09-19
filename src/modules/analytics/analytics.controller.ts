import { Request, Response } from "express";
import { Order } from "../order/order.model";
import { Customer } from "../customer/customer.model";
import { StoreVisit } from "./storeVisit.model";
import ApiResponse from "../../utils/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";

const recordVisit = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, sessionId } = req.body;
  if (!tenantId || !sessionId) {
    return ApiResponse.sendError(res, 400, "Missing required fields");
  }

  // We consider a visit unique per tenant per session ID per 24 hours
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const existingVisit = await StoreVisit.findOne({
    tenantId,
    sessionId,
    createdAt: { $gte: startOfDay },
  });

  if (!existingVisit) {
    await StoreVisit.create({ tenantId, sessionId });
  }

  ApiResponse.sendSuccess(res, 200, "Visit recorded");
});

const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = (req as any).user.tenantId;
  const days = parseInt(req.query.days as string) || 30;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Totals based on timeframe
  const totalOrders = await Order.countDocuments({
    tenantId,
    createdAt: { $gte: startDate },
  });

  // Total customers can just be all-time for the tenant, or created in timeframe
  const totalCustomers = await Customer.countDocuments({ tenantId });

  const mongoose = require("mongoose");
  const revenueResult = await Order.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        createdAt: { $gte: startDate },
        status: { $regex: new RegExp("^delivered$", "i") },
      },
    },
    { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" } } },
  ]);
  const totalRevenue =
    revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

  // Get total unique visits in this timeframe
  const totalVisits = await StoreVisit.countDocuments({
    tenantId,
    createdAt: { $gte: startDate },
  });
  let conversionRate = 0;
  if (totalVisits > 0) {
    conversionRate = parseFloat(((totalOrders / totalVisits) * 100).toFixed(2));
    if (conversionRate > 100) conversionRate = 100; // Cap at 100%
  }

  // Compute chart data dynamically
  const orders = await Order.find({
    tenantId,
    createdAt: { $gte: startDate },
  }).sort({ createdAt: 1 });

  const chartDataMap: Record<
    string,
    { name: string; revenue: number; orders: number }
  > = {};

  orders.forEach((order) => {
    let dateStr;
    if (days <= 30) {
      dateStr = new Date(order.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } else {
      dateStr = new Date(order.createdAt).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
    }

    let currentData = chartDataMap[dateStr];
    if (!currentData) {
      currentData = { name: dateStr, revenue: 0, orders: 0 };
      chartDataMap[dateStr] = currentData;
    }

    currentData.orders += 1;
    if (order.status?.toLowerCase() === "delivered") {
      currentData.revenue += order.totalPrice;
    }
  });

  const chartData = Object.values(chartDataMap);

  ApiResponse.sendSuccess(res, 200, "Dashboard stats retrieved", {
    totalOrders,
    totalCustomers,
    totalRevenue,
    chartData,
    conversionRate,
    totalVisits,
  });
});

const getDashboardSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantId = (req as any).user.tenantId;
    const days = parseInt(req.query.days as string) || 7;
    const mongoose = require("mongoose");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { Tenant } = require("../tenant/tenant.model");
    const { Subscription } = require("../subscription/subscription.model");
    const { Product } = require("../product/product.model");
    const { Category } = require("../category/category.model");

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
      allCats,
      totalVisits,
    ] = await Promise.all([
      Tenant.findById(tenantId).select("name slug showDemoSeed"),
      Order.countDocuments({ tenantId, createdAt: { $gte: startDate } }),
      Customer.countDocuments({ tenantId }),
      Order.aggregate([
        {
          $match: {
            tenantId: new mongoose.Types.ObjectId(tenantId),
            createdAt: { $gte: startDate },
            status: { $regex: new RegExp("^delivered$", "i") },
          },
        },
        { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" } } },
      ]),
      Order.find({ tenantId }).sort({ createdAt: -1 }).limit(5),
      Subscription.findOne({ tenantId, status: "active" }).populate(
        "packageId",
      ),
      Product.countDocuments({ tenantId }),
      Product.countDocuments({ tenantId, status: "DRAFT" }),
      Product.find({ tenantId }).sort({ salesCount: -1 }).limit(4).lean(),
      Category.find({ tenantId }).select("status"),
      StoreVisit.countDocuments({ tenantId, createdAt: { $gte: startDate } }),
    ]);

    const totalRevenue =
      revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

    let conversionRate = 0;
    if (totalVisits > 0) {
      conversionRate = parseFloat(
        ((totalOrders / totalVisits) * 100).toFixed(2),
      );
      if (conversionRate > 100) conversionRate = 100;
    }

    // Calculate category stats
    const categoryStats = {
      total: allCats.length,
      active: allCats.filter((c: any) => c.status !== "INACTIVE").length,
      inactive: allCats.filter((c: any) => c.status === "INACTIVE").length,
    };

    const productStats = {
      total: totalProds,
      active: totalProds - draftProds,
      inactive: draftProds,
    };

    // Compile final result
    const summary = {
      store: storeInfo,
      stats: {
        totalRevenue,
        totalOrders,
        totalCustomers,
        conversionRate,
        totalVisits,
      },
      recentOrders,
      subscription,
      productStats,
      topProducts,
      categoryStats,
    };

    ApiResponse.sendSuccess(res, 200, "Dashboard summary retrieved", summary);
  },
);

const getSuperAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const { Tenant } = require("../tenant/tenant.model");
  const { Subscription } = require("../subscription/subscription.model");
  const os = require("os");

  const totalTenants = await Tenant.countDocuments();
  
  // Fetch ALL subscriptions for history and sales calculations
  const allSubscriptions = await Subscription.find({})
    .populate("packageId")
    .populate("tenantId", "name")
    .populate("purchasedAddons.addonId", "name price");

  const activeSubscriptions = allSubscriptions.filter((sub: any) => sub.status === "active");

  const activePackages = activeSubscriptions.length;
  const monthlyMRR = activeSubscriptions.reduce((acc: number, sub: any) => {
    let addonTotal = 0;
    if (sub.purchasedAddons && sub.purchasedAddons.length > 0) {
      sub.purchasedAddons.forEach((pa: any) => {
        if (pa.status === 'active' && pa.addonId) {
          addonTotal += pa.addonId.price || 0;
        }
      });
    }
    const pkgPrice = sub.isTrial ? 0 : (sub.packageId?.price || 0);
    return acc + pkgPrice + addonTotal;
  }, 0);

  // Calculate Historical Sales
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let monthlySales = 0;
  let yearlySales = 0;
  let totalSales = 0;

  const transactions = allSubscriptions.map((sub: any) => {
    let addonPrice = 0;
    let addonNames: string[] = [];

    if (sub.purchasedAddons && sub.purchasedAddons.length > 0) {
      sub.purchasedAddons.forEach((pa: any) => {
        if (pa.status === 'active' && pa.addonId) {
          addonPrice += pa.addonId.price || 0;
          addonNames.push(pa.addonId.name);
        }
      });
    }

    let packagePrice = 0;
    // Assume revenue is generated only if not a trial and status is active or expired
    if (!sub.isTrial && (sub.status === 'active' || sub.status === 'expired')) {
      packagePrice = sub.packageId?.price || 0;
    }

    const price = packagePrice + addonPrice;
    const subDate = new Date(sub.createdAt);
    
    totalSales += price;
    
    if (subDate.getFullYear() === currentYear) {
      yearlySales += price;
      if (subDate.getMonth() === currentMonth) {
        monthlySales += price;
      }
    }

    return {
      id: sub._id,
      tenantName: sub.tenantId?.name || "Unknown",
      packageName: sub.packageId?.name || "Free tier",
      addons: addonNames.join(", "),
      amount: price,
      status: sub.status,
      date: sub.createdAt
    };
  }).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Since os.loadavg() is often 0 on Windows, we'll use memory usage for a realistic cross-platform load metric
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const systemLoad = Math.round(((totalMem - freeMem) / totalMem) * 100);

  // Revenue chart data (mocked historically, based on current MRR for now)
  const chartData = [
    { name: "Jan", revenue: parseFloat((monthlyMRR * 0.7).toFixed(2)) },
    { name: "Feb", revenue: parseFloat((monthlyMRR * 0.75).toFixed(2)) },
    { name: "Mar", revenue: parseFloat((monthlyMRR * 0.8).toFixed(2)) },
    { name: "Apr", revenue: parseFloat((monthlyMRR * 0.9).toFixed(2)) },
    { name: "May", revenue: parseFloat((monthlyMRR * 0.95).toFixed(2)) },
    { name: "Jun", revenue: parseFloat(monthlyMRR.toFixed(2)) },
    { name: "Jul", revenue: parseFloat(monthlyMRR.toFixed(2)) },
  ];

  ApiResponse.sendSuccess(res, 200, "Super admin stats retrieved", {
    totalTenants,
    activePackages,
    monthlyMRR,
    systemLoad: `${systemLoad}%`,
    monthlySales: parseFloat(monthlySales.toFixed(2)),
    yearlySales: parseFloat(yearlySales.toFixed(2)),
    totalSales: parseFloat(totalSales.toFixed(2)),
    transactions,
    chartData,
  });
});

export const AnalyticsController = {
  recordVisit,
  getDashboardStats,
  getSuperAdminStats,
  getDashboardSummary,
};
