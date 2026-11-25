import { Types } from 'mongoose';
import CustomError from '../../helpers/CustomError';
import { Customer } from './customer.model';
import { ICustomer } from './customer.interface';
import { Order } from '../order/order.model';
import { paginationHelper } from '../../helpers/paginationHelper';

const createCustomer = async (payload: Partial<ICustomer>) => {
  const result = await Customer.create(payload);
  return result;
};

const getCustomersByTenant = async (tenantId: string, query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query.page, query.limit);

  const filter: any = { tenantId };

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { phone: { $regex: query.search, $options: 'i' } },
    ];
  }

  const [customers, total] = await Promise.all([
    Customer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Customer.countDocuments(filter),
  ]);

  // If searching (e.g. phone lookup on Manual Order), backfill any missing address from the customer's latest Order
  let enrichedData = customers;
  if (query.search && customers.length > 0) {
    const phonesToBackfill = customers
      .filter((c: any) => !c.address && c.phone)
      .map((c: any) => c.phone);

    if (phonesToBackfill.length > 0) {
      const latestOrders = await Order.find(
        {
          tenantId,
          customerPhone: { $in: phonesToBackfill },
          shippingAddress: { $exists: true, $ne: '' },
        },
        { customerPhone: 1, shippingAddress: 1, customerEmail: 1 }
      )
        .sort({ createdAt: -1 })
        .lean();

      const phoneToOrderMap = new Map<string, { address: string; email?: string | undefined }>();
      for (const ord of latestOrders) {
        if (ord.customerPhone && ord.shippingAddress && !phoneToOrderMap.has(ord.customerPhone)) {
          phoneToOrderMap.set(ord.customerPhone, {
            address: ord.shippingAddress,
            email: ord.customerEmail,
          });
        }
      }

      enrichedData = customers.map((c: any) => {
        const match = c.phone ? phoneToOrderMap.get(c.phone) : undefined;
        return {
          ...c,
          address: c.address || match?.address || '',
          email: c.email || match?.email || '',
        };
      });
    }
  }

  return {
    data: enrichedData,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// Super admin: read-only customer list for a given tenant
const getCustomersForAdmin = async (tenantId: string, query: any = {}) => {
  if (!Types.ObjectId.isValid(tenantId)) {
    throw new CustomError(400, 'Invalid tenant ID');
  }
  const { page, limit, skip } = paginationHelper(query.page, query.limit);

  const filter: any = { tenantId: new Types.ObjectId(tenantId) };
  if (query.search) {
    const escaped = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
    ];
  }

  const [data, total] = await Promise.all([
    Customer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Customer.countDocuments(filter),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const CustomerService = {
  createCustomer,
  getCustomersByTenant,
  getCustomersForAdmin,
};
