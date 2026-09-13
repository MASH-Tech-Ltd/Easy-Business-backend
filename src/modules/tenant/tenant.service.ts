import { ITenant } from "./tenant.interface";
import { Tenant } from "./tenant.model";
import { User } from "../auth/auth.model";
import CustomError from "../../helpers/CustomError";
import { deleteCloudinary } from '../../helpers/cloudinary';
import { paginationHelper } from "../../helpers/paginationHelper";
import { Subscription } from "../subscription/subscription.model";
import { Order } from "../order/order.model";
import { Courier } from "../courier/courier.model";
import { FraudCheck } from "../fraudCheck/fraudCheck.model";
import { Category } from "../category/category.model";
import { Product } from "../product/product.model";
import mongoose from "mongoose";

const createTenant = async (payload: any): Promise<ITenant> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Create the tenant
    const tenantPayload: any = {
      name: payload.tenantName,
      logo: payload.logo,
      status: 'active',
      slug: payload.subdomain || payload.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
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
  const subscriptions = await Subscription.find({
    tenantId: { $in: tenantIds },
    status: 'active'
  }).populate('packageId');

  const dataWithPackages = data.map((tenant) => {
    const sub = subscriptions.find((s) => s.tenantId.toString() === tenant._id.toString());
    return {
      ...tenant,
      package: sub && sub.packageId ? sub.packageId : null,
      subscription: sub || null
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
  return store;
};

const updateMyStore = async (tenantId: string, payload: any) => {
  const updatedStore = await Tenant.findByIdAndUpdate(tenantId, payload, { new: true });
  if (!updatedStore) {
    throw new CustomError(404, 'Store not found');
  }
  return updatedStore;
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

  const updatedTenant = await Tenant.findByIdAndUpdate(id, updateQuery, { new: true });
  if (!updatedTenant) {
    throw new CustomError(404, 'Tenant not found');
  }
  return updatedTenant;
};

const getTenantMetrics = async (tenantId: string) => {
  const [
    totalOrders, 
    fraudChecks, 
    courierConfigs,
    totalCategories,
    activeCategories,
    totalProducts,
    activeProducts
  ] = await Promise.all([
    Order.countDocuments({ tenantId }),
    FraudCheck.countDocuments({ tenantId }),
    Courier.find({ tenantId }),
    Category.countDocuments({ tenantId }),
    Category.countDocuments({ tenantId, status: 'ACTIVE' }),
    Product.countDocuments({ tenantId }),
    Product.countDocuments({ tenantId, status: 'ACTIVE' })
  ]);

  const configuredCouriers = courierConfigs.filter(c => c.provider).map(c => c.provider);

  return {
    totalOrders,
    fraudChecks,
    courierStatus: configuredCouriers.length > 0 ? `Configured (${configuredCouriers.length})` : 'Not Configured',
    configuredCouriers,
    totalCategories,
    activeCategories,
    totalProducts,
    activeProducts
  };
};

const deleteTenant = async (id: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const tenant = await Tenant.findByIdAndDelete(id, { session });
    if (!tenant) {
      throw new CustomError(404, 'Tenant not found');
    }
    
    // Find the user to delete their avatar
    const adminUser = await User.findOne({ tenantId: id }, null, { session });
    if (adminUser && adminUser.avatar && adminUser.avatar.public_id) {
      const { deleteCloudinary } = require('../../helpers/cloudinary');
      await deleteCloudinary(adminUser.avatar.public_id, 'image').catch((err: any) => console.error("Cloudinary delete error:", err));
    }
    
    // Also delete the associated admin user
    if (adminUser) {
      await User.findByIdAndDelete(adminUser._id, { session });
    }
    
    // Cascading deletes for all tenant data
    
    // 1. Delete product images from Cloudinary
    const products = await Product.find({ tenantId: id }, null, { session });
    if (products.length > 0) {
      const { deleteCloudinary } = require('../../helpers/cloudinary');
      for (const product of products) {
        if (product.images && product.images.length > 0) {
          for (const image of product.images) {
            if (image.public_id) {
              await deleteCloudinary(image.public_id, 'image').catch((err: any) => console.error("Cloudinary delete error:", err));
            }
          }
        }
      }
    }

    // 2. Delete tenant logo from Cloudinary
    if (tenant.logo && typeof tenant.logo === 'string') {
       const parts = tenant.logo.split('/');
       const filename = parts.pop();
       if (filename) {
         const publicId = filename.split('.')[0];
         if (publicId) {
           await deleteCloudinary(publicId, 'image').catch((err: any) => console.error("Cloudinary delete error:", err));
         }
       }
    }
    
    await Product.deleteMany({ tenantId: id }, { session });
    await Category.deleteMany({ tenantId: id }, { session });
    await Order.deleteMany({ tenantId: id }, { session });
    await Subscription.deleteMany({ tenantId: id }, { session });
    await FraudCheck.deleteMany({ tenantId: id }, { session });
    await Courier.deleteMany({ tenantId: id }, { session });
    
    await session.commitTransaction();
    session.endSession();
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
  getStoreInfoByDomain,
  updateTenant,
  getTenantMetrics,
  deleteTenant
};
