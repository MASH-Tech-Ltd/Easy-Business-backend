import { ITenant } from "./tenant.interface";
import { Tenant } from "./tenant.model";
import { User } from "../auth/auth.model";
import CustomError from "../../helpers/CustomError";
import { deleteCloudinary, deleteMultipleCloudinary } from '../../helpers/cloudinary';
import { paginationHelper } from "../../helpers/paginationHelper";
import { Subscription } from "../subscription/subscription.model";
import { Order } from "../order/order.model";
import { Courier } from "../courier/courier.model";
import { FraudCheck } from "../fraudCheck/fraudCheck.model";
import { Category } from "../category/category.model";
import { Product } from "../product/product.model";
import mongoose from "mongoose";
import axios from "axios";
import config from "../../config";

const notifyTenantUpdate = async (tenantId?: string) => {
  try {
    const io = require('../../socket').getIO();
    const { User } = require('../auth/auth.model');
    const superAdmins = await User.find({ role: 'super_admin' });
    for (const admin of superAdmins) {
      io.to('user_' + admin._id.toString()).emit('refresh_tenants');
    }
    if (tenantId) {
      const tenant = await Tenant.findById(tenantId);
      const event = tenant?.status === 'banned' ? 'account_banned' : 'account_status_changed';
      if (tenant && tenant.ownerId) {
        io.to('user_' + tenant.ownerId.toString()).emit(event);
      }
      // ownerId is not always set on tenants, so also notify every user of this tenant
      const tenantUsers = await User.find({ tenantId }).select('_id').lean();
      for (const u of tenantUsers) {
        io.to('user_' + u._id.toString()).emit(event);
      }
    }
  } catch (error) {}
};

const createTenant = async (payload: any): Promise<ITenant> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Create the tenant
    const baseSlug = payload.subdomain || payload.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const uniqueSlug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;

    const tenantPayload: any = {
      name: payload.tenantName,
      logo: payload.logo,
      status: 'active',
      slug: uniqueSlug,
    };

    if (payload.domain && payload.domain.trim() !== '') {
      tenantPayload.domain = payload.domain;
    }

    const newTenant: any = await Tenant.create([tenantPayload], { session });

    // 2. Create the tenant admin user
    const adminUser: any = await User.create(
      [
        {
          name: payload.adminName,
          email: payload.adminEmail,
          password: payload.adminPassword,
          role: "tenant_admin",
          tenantId: newTenant[0]._id,
        },
      ],
      { session },
    );

    // 3. Update tenant with ownerId
    newTenant[0].ownerId = adminUser[0]._id;
    await newTenant[0].save({ session });

    // 4. Create a 5-day free trial subscription (first-time only, no package required)
    const trialStart = new Date();
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 5);

    await Subscription.create([{
      tenantId: newTenant[0]._id,
      startDate: trialStart,
      endDate: trialEnd,
      status: 'active',
      isTrial: true,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return newTenant[0];
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const getAllTenants = async (
  query: any,
): Promise<{ data: any[]; meta: any }> => {
  const { page, limit, skip } = paginationHelper(query?.page, query?.limit);
  const { search, sortBy, sortOrder } = query;

  const filter: any = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { domain: { $regex: search, $options: "i" } },
    ];
  }

  const sortCondition: any = {};
  if (sortBy) {
    sortCondition[sortBy] = sortOrder === "asc" ? 1 : -1;
  } else {
    sortCondition["createdAt"] = -1;
  }

  const [data, total] = await Promise.all([
    Tenant.find(filter)
      .populate("ownerId")
      .sort(sortCondition)
      .skip(skip)
      .limit(limit)
      .lean(),
    Tenant.countDocuments(filter),
  ]);

  const tenantIds = data.map((t) => t._id);
  const [subscriptions, productCounts, categoryCounts] = await Promise.all([
    Subscription.find({
      tenantId: { $in: tenantIds }
    }).sort({ createdAt: -1 }).populate('packageId').lean(),
    Product.aggregate([
      { $match: { tenantId: { $in: tenantIds } } },
      { $group: { _id: '$tenantId', count: { $sum: 1 } } }
    ]),
    Category.aggregate([
      { $match: { tenantId: { $in: tenantIds } } },
      { $group: { _id: '$tenantId', count: { $sum: 1 } } }
    ])
  ]);

  const productMap = new Map<string, number>();
  productCounts.forEach((p) => productMap.set(p._id.toString(), p.count));

  const categoryMap = new Map<string, number>();
  categoryCounts.forEach((c) => categoryMap.set(c._id.toString(), c.count));

  const dataWithPackages = data.map((tenant) => {
    const tIdStr = tenant._id.toString();
    const tenantSubs = subscriptions.filter((s) => s.tenantId?.toString() === tIdStr);
    // Prefer active subscription if available, else latest subscription
    const sub = tenantSubs.find((s) => s.status === 'active') || tenantSubs[0];
    return {
      ...tenant,
      isOnline: tenant.isOnline !== false,
      isOnlineByAdmin: tenant.isOnlineByAdmin !== false,
      totalProducts: productMap.get(tIdStr) || 0,
      totalCategories: categoryMap.get(tIdStr) || 0,
      package: sub && sub.packageId ? sub.packageId : null,
      subscription: sub ? {
        _id: sub._id,
        status: sub.status,
        isTrial: sub.isTrial,
        startDate: sub.startDate,
        endDate: sub.endDate,
        packageName: (sub.packageId as any)?.name || (sub.isTrial ? 'Free Trial' : 'Custom Plan')
      } : null
    };
  });

  return {
    data: dataWithPackages,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getMyStore = async (tenantId: string) => {
  const store = await Tenant.findById(tenantId).populate('ownerId', 'name email');
  if (!store) {
    throw new CustomError(404, 'Store not found');
  }

  // Auto-check Cloudflare status if domain is pending
  if (store.domainStatus === 'pending' && store.customDomain) {
    try {
      if (config.cloudflare.zoneId && config.cloudflare.apiToken) {
        const getRes = await axios.get(
          `https://api.cloudflare.com/client/v4/zones/${config.cloudflare.zoneId}/custom_hostnames?hostname=${store.customDomain}`,
          {
            headers: {
              Authorization: `Bearer ${config.cloudflare.apiToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        const cfData = getRes.data.result[0];
        if (cfData) {
          const newStatus = cfData.status === 'active' ? 'active' : 'pending';
          if (newStatus !== store.domainStatus) {
            store.domainStatus = newStatus;
            await store.save();
          }
        }
      }
    } catch (err) {
      console.error('Failed to auto-check domain status in background', err);
    }
  }

  return store;
};

const updateMyStore = async (tenantId: string, payload: any) => {
  const existingStore = await Tenant.findById(tenantId);
  if (!existingStore) {
    throw new CustomError(404, 'Store not found');
  }

  let targetOnline: boolean | undefined = undefined;
  if (payload.isOnline !== undefined) {
    targetOnline = payload.isOnline === true || payload.isOnline === 'true';
  }

  if (targetOnline !== undefined) {
    const isOnlineByAdmin = existingStore.isOnlineByAdmin !== false;
    if (!isOnlineByAdmin && targetOnline === true) {
      throw new CustomError(
        403,
        'Your store has been set offline by Super Admin. Please contact support to reactivate your storefront.'
      );
    }
    payload.isOnline = targetOnline;
  }

  const updatedStore = await Tenant.findByIdAndUpdate(tenantId, payload, { returnDocument: 'after', strict: false });
  if (!updatedStore) {
    throw new CustomError(404, 'Store not found');
  }
  return updatedStore;
};

const updateSlug = async (tenantId: string, newSlug: string) => {
  if (!newSlug) throw new CustomError(400, 'New subdomain name is required');
  
  // Convert to valid slug
  const formattedSlug = newSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

  if (formattedSlug.length < 3) throw new CustomError(400, 'Subdomain must be at least 3 characters long');

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new CustomError(404, 'Store not found');

  if (tenant.slug === formattedSlug) {
    throw new CustomError(400, 'This is already your active subdomain');
  }

  const existing = await Tenant.findOne({ slug: formattedSlug });
  if (existing) {
    throw new CustomError(400, 'This subdomain name already exists. Please choose another one.');
  }

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  if (!tenant.slugChanges) tenant.slugChanges = [];
  
  // Filter only changes within the last 24 hours
  tenant.slugChanges = tenant.slugChanges.filter(date => new Date(date) > oneDayAgo);
  
  if (tenant.slugChanges.length >= 2) {
    throw new CustomError(400, 'You can only change your subdomain 2 times per day.');
  }

  tenant.slugChanges.push(now);
  tenant.slug = formattedSlug;
  await tenant.save();

  return tenant;
};

const addCustomDomain = async (tenantId: string, customDomain: string) => {
  if (!customDomain) {
    throw new CustomError(400, 'Custom domain is required');
  }
  if (customDomain.startsWith('www.')) {
    customDomain = customDomain.replace(/^www\./, '');
  }

  // Ensure Cloudflare config exists
  if (!config.cloudflare.zoneId || !config.cloudflare.apiToken) {
    throw new CustomError(500, 'Cloudflare configuration is missing on the server');
  }

  try {
    // Cloudflare API call to add custom hostname
    const cfResponse = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${config.cloudflare.zoneId}/custom_hostnames`,
      {
        hostname: customDomain,
        ssl: {
          method: 'http',
          type: 'dv',
          settings: {
            http2: 'on',
            tls_1_3: 'on'
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${config.cloudflare.apiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const cfData = cfResponse.data.result;
    const validationRecords = [...(cfData?.ssl?.validation_records || [])];
    
    if (cfData?.ownership_verification) {
      validationRecords.push({
        txt_name: cfData.ownership_verification.name,
        txt_value: cfData.ownership_verification.value
      });
    }

    if (cfData?.ownership_verification_http) {
      validationRecords.push({
        http_url: cfData.ownership_verification_http.http_url,
        http_body: cfData.ownership_verification_http.http_body
      });
    }

    // Database-e domain ebong validation records save korun
    const updatedStore = await Tenant.findByIdAndUpdate(tenantId, {
      customDomain: customDomain,
      domainStatus: 'pending',
      sslValidationRecords: validationRecords
    }, { returnDocument: 'after' });

    if (!updatedStore) {
      throw new CustomError(404, 'Store not found');
    }

    return {
      store: updatedStore,
      records: validationRecords
    };
  } catch (error: any) {
    const errorCode = error.response?.data?.errors?.[0]?.code;
    const errorMessage = error.response?.data?.errors?.[0]?.message || 'Failed to add custom domain via Cloudflare';

    // 81057 is Cloudflare's Duplicate Custom Hostname error code
    if (errorCode === 81057 || errorMessage.toLowerCase().includes('duplicate')) {
      try {
        // Fetch existing custom hostname details to check if it's active now
        const getRes = await axios.get(
          `https://api.cloudflare.com/client/v4/zones/${config.cloudflare.zoneId}/custom_hostnames?hostname=${customDomain}`,
          {
            headers: {
              Authorization: `Bearer ${config.cloudflare.apiToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        const cfData = getRes.data.result[0];
        if (cfData) {
          const validationRecords = [...(cfData?.ssl?.validation_records || [])];
          
          if (cfData?.ownership_verification) {
            validationRecords.push({
              txt_name: cfData.ownership_verification.name,
              txt_value: cfData.ownership_verification.value
            });
          }

          if (cfData?.ownership_verification_http) {
            validationRecords.push({
              http_url: cfData.ownership_verification_http.http_url,
              http_body: cfData.ownership_verification_http.http_body
            });
          }
          // Cloudflare statuses: 'active', 'pending', 'moved', 'deleted'
          const domainStatus = cfData.status === 'active' ? 'active' : 'pending';

          const updatedStore = await Tenant.findByIdAndUpdate(tenantId, {
            customDomain: customDomain,
            domainStatus: domainStatus,
            sslValidationRecords: validationRecords
          }, { returnDocument: 'after' });

          if (!updatedStore) throw new CustomError(404, 'Store not found');

          return {
            store: updatedStore,
            records: validationRecords,
            isRetry: true,
            status: domainStatus
          };
        }
      } catch (err) {
        console.error('Failed to fetch existing hostname details', err);
      }
      throw new CustomError(400, 'Domain verification is already in progress. Please check your DNS records and wait a few minutes.');
    }

    console.error('Cloudflare Error:', error.response?.data || error.message);
    throw new CustomError(500, errorMessage);
  }
};

const getStoreInfoByDomain = async (domain: string) => {
  // SECURITY FIX: Removed localhost fallback — it was leaking the first tenant's data
  // to anyone who sent domain=localhost. Always do an exact domain lookup.
  const store = await Tenant.findOne({ domain });
  if (!store) {
    throw new CustomError(404, 'Store not found for domain');
  }
  return store;
};

const updateTenant = async (id: string, payload: Partial<ITenant>) => {
  if (payload.isOnline !== undefined) {
    (payload as any).isOnlineByAdmin = payload.isOnline;
  }

  const updateQuery: any = { $set: { ...payload } };
  const unsetQuery: any = {};

  if (updateQuery.$set.domain === '') {
    delete updateQuery.$set.domain;
    unsetQuery.domain = 1;
  }
  if (updateQuery.$set.customDomain === '') {
    delete updateQuery.$set.customDomain;
    unsetQuery.customDomain = 1;
  }

  if (Object.keys(unsetQuery).length > 0) {
    updateQuery.$unset = unsetQuery;
  }

  const updatedTenant = await Tenant.findByIdAndUpdate(id, updateQuery, { returnDocument: 'after', strict: false });
  if (!updatedTenant) {
    throw new CustomError(404, 'Tenant not found');
  }

  // A banned merchant loses all active sessions immediately
  if (payload.status === 'banned') {
    await User.updateMany({ tenantId: id }, { $set: { refreshTokens: [] } });
  }
  if (payload.status || payload.isOnline !== undefined) {
    await notifyTenantUpdate(id);
  }
  return updatedTenant;
};

const getTenantMetrics = async (tenantId: string, query?: any) => {
  let dateFilter: any = {};

  if (query) {
    const { filter, month, year, startDate, endDate } = query;
    if (filter === 'month' && month && year) {
      const start = new Date(parseInt(year), parseInt(month) - 1, 1);
      const end = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
      dateFilter.createdAt = { $gte: start, $lte: end };
    } else if (filter === 'custom' && startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.createdAt = { $gte: start, $lte: end };
    }
  }

  const baseFilter = { tenantId };
  const dateSpecificFilter = { tenantId, ...dateFilter };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
  const dateSpecificFilterAgg = { ...dateSpecificFilter, tenantId: tenantObjectId };

  const [
    totalOrders, 
    fraudChecks, 
    courierConfigs,
    totalCategories,
    activeCategories,
    totalProducts,
    activeProducts,
    subscription,
    revenueData,
    thisMonthRevenue,
    thisYearRevenue,
    pipelineData
  ] = await Promise.all([
    Order.countDocuments(dateSpecificFilter),
    FraudCheck.countDocuments(dateSpecificFilter),
    Courier.find(baseFilter),
    Category.countDocuments(dateSpecificFilter),
    Category.countDocuments({ ...dateSpecificFilter, status: 'ACTIVE' }),
    Product.countDocuments(dateSpecificFilter),
    Product.countDocuments({ ...dateSpecificFilter, status: 'ACTIVE' }),
    Subscription.findOne({ tenantId, status: 'active' })
      .populate('packageId')
      .populate('purchasedAddons.addonId'),
    Order.aggregate([
      { $match: { ...dateSpecificFilterAgg, status: 'delivered' } },
      { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" }, deliveredOrders: { $sum: 1 } } }
    ]),
    Order.aggregate([
      { $match: { tenantId: tenantObjectId, status: 'delivered', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" } } }
    ]),
    Order.aggregate([
      { $match: { tenantId: tenantObjectId, status: 'delivered', createdAt: { $gte: startOfYear } } },
      { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" } } }
    ]),
    Order.aggregate([
      { $match: dateSpecificFilterAgg },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ])
  ]);

  const configuredCouriers = courierConfigs.filter(c => c.provider).map(c => c.provider);
  
  const pipeline: Record<string, number> = {
    pending: 0,
    confirmed: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0
  };
  pipelineData.forEach(p => {
    if (pipeline[p._id] !== undefined) {
      pipeline[p._id] = p.count;
    }
  });

  return {
    totalOrders,
    fraudChecks,
    courierStatus: configuredCouriers.length > 0 ? `Configured (${configuredCouriers.length})` : 'Not Configured',
    configuredCouriers,
    totalCategories,
    activeCategories,
    totalProducts,
    activeProducts,
    subscription,
    advancedAnalytics: {
      filteredRevenue: revenueData[0]?.totalRevenue || 0,
      filteredDeliveredOrders: revenueData[0]?.deliveredOrders || 0,
      thisMonthRevenue: thisMonthRevenue[0]?.totalRevenue || 0,
      thisYearRevenue: thisYearRevenue[0]?.totalRevenue || 0,
      pipeline
    }
  };
};

const deleteTenant = async (id: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tenant = await Tenant.findById(id).session(session);
    if (!tenant) {
      throw new CustomError(404, 'Tenant not found');
    }
    
    // Find products, categories, and admin user before deleting to gather image public IDs
    const [adminUser, products, categories] = await Promise.all([
      User.findOne({ tenantId: id }, null, { session }),
      Product.find({ tenantId: id }, 'images', { session }),
      Category.find({ tenantId: id }, 'image', { session })
    ]);

    const publicIdsToDelete: string[] = [];

    if (adminUser?.avatar?.public_id) {
      publicIdsToDelete.push(adminUser.avatar.public_id);
    }

    if (tenant.logo && typeof tenant.logo === 'string') {
      const parts = tenant.logo.split('/');
      const filename = parts.pop();
      if (filename) {
        const publicId = filename.split('.')[0];
        if (publicId) publicIdsToDelete.push(publicId);
      }
    }

    products.forEach((product) => {
      product.images?.forEach((img) => {
        if (img.public_id) publicIdsToDelete.push(img.public_id);
      });
    });

    categories.forEach((cat: any) => {
      if (cat.image?.public_id) {
        publicIdsToDelete.push(cat.image.public_id);
      }
    });

    // Sequential ACID cascading deletes on the active session (prevents MongoDB transaction write conflicts)
    await Tenant.findByIdAndDelete(id, { session });
    await User.deleteMany({ tenantId: id }, { session });
    await Product.deleteMany({ tenantId: id }, { session });
    await Category.deleteMany({ tenantId: id }, { session });
    await Order.deleteMany({ tenantId: id }, { session });
    await Subscription.deleteMany({ tenantId: id }, { session });
    await FraudCheck.deleteMany({ tenantId: id }, { session });
    await Courier.deleteMany({ tenantId: id }, { session });

    await session.commitTransaction();
    session.endSession();

    // Perform Cloudinary image deletions reliably
    if (publicIdsToDelete.length > 0) {
      deleteMultipleCloudinary(publicIdsToDelete, 'image').catch((err) =>
        console.error('Background Cloudinary cleanup error on deleteTenant:', err)
      );
    }

    await notifyTenantUpdate(id);
    return tenant;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

export const TenantService = {
  createTenant,
  getAllTenants,
  getMyStore,
  updateMyStore,
  updateSlug,
  addCustomDomain,
  getStoreInfoByDomain,
  updateTenant,
  getTenantMetrics,
  deleteTenant
};
