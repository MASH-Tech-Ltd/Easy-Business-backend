import { Order } from './order.model';
import CustomError from '../../helpers/CustomError';
import { IOrder } from './order.interface';
import { Customer } from '../customer/customer.model';
import { Product } from '../product/product.model';
import { Subscription } from '../subscription/subscription.model';
import { getIO } from '../../socket';
import { Notification } from '../notification/notification.model';
import { Theme } from '../theme/theme.model';
import { computeShipping } from '../../utils/computeShipping';
import { paginationHelper } from '../../helpers/paginationHelper';
import { User } from '../auth/auth.model';

const normalizeBDPhone = (phone: string): string => {
  const digits = (phone || '').replace(/[\s\-()]/g, '').trim();
  if (digits.startsWith('+880')) return '0' + digits.slice(4);
  if (digits.startsWith('880')) return '0' + digits.slice(3);
  return digits;
};

const generateUniqueOrderId = async (): Promise<string> => {
  let newOrderId = '';
  let isUnique = false;
  while (!isUnique) {
    newOrderId = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await Order.findOne({ orderId: newOrderId }).select('_id').lean();
    if (!existing) isUnique = true;
  }
  return newOrderId;
};

const createOrder = async (payload: IOrder): Promise<IOrder> => {
  // ─── SECURITY: Recalculate shipping from the DB, ignore client-sent values ───
  // Extract the shipping address parts (expected format: "street, upazila, district, division")
  const addressParts = (payload.shippingAddress || '').split(',').map((p: string) => p.trim());
  const district = addressParts[addressParts.length - 2] || '';
  const division = addressParts[addressParts.length - 1] || '';

  try {
    // ── Step 1: Fetch real product prices from DB (prevents client price manipulation) ──
    const productIds = payload.items.map((item: any) => item.productId);
    const dbProducts = await Product.find(
      { _id: { $in: productIds }, tenantId: payload.tenantId },
      { _id: 1, discountedPrice: 1, originalPrice: 1, stock: 1, title: 1, hasVariants: 1, variants: 1 }
    );

    // Build a map of productId → DB product doc
    const productMap = new Map<string, any>(
      dbProducts.map((p: any) => [p._id.toString(), p])
    );

    // Override each item's price with the real DB value and reject unknown or out-of-stock products
    for (const item of payload.items as any[]) {
      const dbProduct = productMap.get(item.productId.toString());
      if (!dbProduct) {
        console.error('DEBUG priceMap keys:', Array.from(productMap.keys()));
        console.error('DEBUG item.productId:', item.productId, typeof item.productId);
        console.error('DEBUG payload.tenantId:', payload.tenantId);
        throw new Error(`Product not found or does not belong to this tenant: ${item.productId}`);
      }

      // Check variant stock if product has variants
      if (dbProduct.hasVariants && Array.isArray(dbProduct.variants) && dbProduct.variants.length > 0) {
        let matchedVariant: any = null;
        if (item.variantId) {
          matchedVariant = dbProduct.variants.find((v: any) => v._id?.toString() === item.variantId?.toString());
        }
        if (!matchedVariant && (item.color || item.size)) {
          matchedVariant = dbProduct.variants.find((v: any) => 
            (!item.color || (v.color || '').toLowerCase() === item.color.toLowerCase()) &&
            (!item.size || (v.size || '').toLowerCase() === item.size.toLowerCase())
          );
        }

        if (matchedVariant) {
          item.variantId = matchedVariant._id?.toString();
          item.color = matchedVariant.color || item.color;
          item.size = matchedVariant.size || item.size;

          if (typeof matchedVariant.stock === 'number' && matchedVariant.stock < item.quantity) {
            const optLabel = [matchedVariant.color, matchedVariant.size].filter(Boolean).join(' / ');
            throw new Error(`Selected option (${optLabel}) is out of stock for ${dbProduct.title}`);
          }
        }
      }

      if (typeof dbProduct.stock === 'number' && dbProduct.stock < item.quantity) {
        throw new Error(`Product out of stock: ${dbProduct.title || item.productId}`);
      }

      item.price = dbProduct.discountedPrice ?? dbProduct.originalPrice; // overwrite client-supplied price
    }

    // ── Step 2: Recompute subTotal from now-trusted item prices ──────────────────
    const trustedSubTotal = payload.items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0
    );

    // ── Step 3: Recalculate shipping from DB ────────────────────────────────────
    const theme = await Theme.findOne({ tenantId: payload.tenantId }).select(
      'shippingZones defaultShippingCost'
    );
    const zones = theme?.shippingZones || [];
    const defaultCost = theme?.defaultShippingCost ?? 120;
    const { cost: trustedShippingCharge } = computeShipping(
      division,
      district,
      zones as any[],
      defaultCost
    );

    // ── Step 4: Override ALL money fields — client values are fully ignored ──────
    payload.subTotal = Math.round(trustedSubTotal);
    payload.discount = 0;
    payload.shippingCharge = trustedShippingCharge;
    payload.totalPrice = payload.isDeliveryChargePaid 
      ? Math.round(trustedSubTotal) 
      : Math.round(trustedSubTotal + trustedShippingCharge);
    payload.orderSourceType = 'storefront';
    payload.orderSource = 'Website';
  } catch (err) {
    // SECURITY: Do NOT fall through — if price recalculation fails, reject the order entirely
    // to prevent client-manipulated prices from being saved.
    throw new CustomError(400, `Order rejected: could not verify product prices. Please try again. (${(err as Error).message})`);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  payload.orderId = await generateUniqueOrderId();

  const result = await Order.create(payload);

  try {
    const existingCustomer = await Customer.findOne({ 
      phone: payload.customerPhone, 
      tenantId: payload.tenantId 
    });

    if (existingCustomer) {
      await Customer.findByIdAndUpdate(existingCustomer._id, {
        $inc: { totalOrders: 1, totalSpent: payload.totalPrice },
        $set: {
          name: payload.customerName,
          ...(payload.shippingAddress ? { address: payload.shippingAddress } : {}),
        },
      });
    } else {
      await Customer.create({
        name: payload.customerName,
        phone: payload.customerPhone,
        ...(payload.shippingAddress ? { address: payload.shippingAddress } : {}),
        tenantId: payload.tenantId,
        totalOrders: 1,
        totalSpent: payload.totalPrice,
      });
    }
  } catch (error) {
    console.error('Error tracking customer details:', error);
  }

  try {
    const io = getIO();
    io.to(`tenant_${payload.tenantId}`).emit('new_order', result);

    // Create database notification for the merchant
    const tenantAdmin = await User.findOne({ tenantId: payload.tenantId, role: 'tenant_admin' });
    if (tenantAdmin) {
      const notification = await Notification.create({
        recipientId: tenantAdmin._id,
        tenantId: payload.tenantId,
        type: 'NEW_ORDER',
        title: 'New Order Received',
        message: `Order from ${payload.customerName} for ${payload.totalPrice} BDT`,
        relatedEntityId: result._id
      });
      // Emit to the merchant's personal user room so the NotificationBell component updates
      io.to(`user_${tenantAdmin._id}`).emit('new_notification', notification);
    }
  } catch (error) {
    console.error('Socket emit error for new_order:', error);
  }

  return result;
};

const createManualOrder = async (
  payload: Partial<IOrder>,
  tenantId: string,
  userId: string
): Promise<IOrder> => {
  if (!tenantId) {
    throw new CustomError(401, 'Unauthorized: Tenant context missing');
  }

  // Verify active subscription
  const activeSubscription = await Subscription.findOne({ tenantId, status: 'active' }).select('_id').lean();
  if (!activeSubscription) {
    throw new CustomError(403, 'No active subscription found. Please subscribe or renew your plan to create orders.');
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new CustomError(400, 'Please select at least one product for the manual order.');
  }

  const cleanPhone = normalizeBDPhone(payload.customerPhone || '');
  if (!/^01[3-9]\d{8}$/.test(cleanPhone)) {
    throw new CustomError(400, 'Please provide a valid 11-digit Bangladeshi phone number (e.g. 01712345678).');
  }

  const productIds = Array.from(new Set(payload.items.map((item: any) => String(item.productId))));
  const dbProducts = await Product.find(
    { _id: { $in: productIds }, tenantId },
    {
      _id: 1,
      discountedPrice: 1,
      originalPrice: 1,
      stock: 1,
      title: 1,
      status: 1,
      images: 1,
      hasVariants: 1,
      variants: 1,
    }
  );

  const productMap = new Map<string, any>(
    dbProducts.map((p: any) => [p._id.toString(), p])
  );

  // Track cumulative requested quantities per product and per variant to prevent split-item stock bypass
  const requestedProductQty = new Map<string, number>();
  const requestedVariantQty = new Map<string, number>();

  const normalizedItems: any[] = [];

  for (const rawItem of payload.items as any[]) {
    const pid = String(rawItem.productId);
    const dbProduct = productMap.get(pid);

    if (!dbProduct) {
      throw new CustomError(400, 'One or more selected products do not exist in your store.');
    }

    if (dbProduct.status && dbProduct.status !== 'ACTIVE') {
      throw new CustomError(400, `Product "${dbProduct.title}" is currently ${dbProduct.status.toLowerCase()} and cannot be ordered.`);
    }

    const qty = Math.max(1, Math.floor(Number(rawItem.quantity) || 1));
    const totalProdQty = (requestedProductQty.get(pid) || 0) + qty;
    requestedProductQty.set(pid, totalProdQty);

    if (typeof dbProduct.stock === 'number' && dbProduct.stock < totalProdQty) {
      throw new CustomError(
        400,
        `Insufficient stock for "${dbProduct.title}". Available: ${dbProduct.stock}, Requested: ${totalProdQty}`
      );
    }

    let variantId: string | undefined = undefined;
    let color: string | undefined = rawItem.color?.trim() || undefined;
    let size: string | undefined = rawItem.size?.trim() || undefined;

    if (dbProduct.hasVariants && Array.isArray(dbProduct.variants) && dbProduct.variants.length > 0) {
      let matchedVariant: any = null;
      if (rawItem.variantId) {
        matchedVariant = dbProduct.variants.find(
          (v: any) => v._id?.toString() === String(rawItem.variantId)
        );
      }
      if (!matchedVariant && (color || size)) {
        matchedVariant = dbProduct.variants.find(
          (v: any) =>
            (!color || (v.color || '').toLowerCase() === color.toLowerCase()) &&
            (!size || (v.size || '').toLowerCase() === size.toLowerCase())
        );
      }

      if (!matchedVariant) {
        throw new CustomError(
          400,
          `Please select a valid variant (color/size) for "${dbProduct.title}".`
        );
      }

      variantId = matchedVariant._id?.toString();
      color = matchedVariant.color || color;
      size = matchedVariant.size || size;

      const vKey = `${pid}_${variantId || `${color || ''}_${size || ''}`}`;
      const totalVarQty = (requestedVariantQty.get(vKey) || 0) + qty;
      requestedVariantQty.set(vKey, totalVarQty);

      if (typeof matchedVariant.stock === 'number' && matchedVariant.stock < totalVarQty) {
        const optLabel = [matchedVariant.color, matchedVariant.size].filter(Boolean).join(' / ');
        throw new CustomError(
          400,
          `Variant (${optLabel}) of "${dbProduct.title}" has insufficient stock. Available: ${matchedVariant.stock}, Requested: ${totalVarQty}`
        );
      }
    }

    const unitPrice = dbProduct.discountedPrice ?? dbProduct.originalPrice ?? 0;
    const itemImage =
      rawItem.image ||
      dbProduct.images?.[0]?.secure_url ||
      '';

    // Merge identical product + variant lines cleanly
    const existingLineIndex = normalizedItems.findIndex(
      (line) =>
        line.productId === pid &&
        (line.variantId || '') === (variantId || '') &&
        (line.color || '') === (color || '') &&
        (line.size || '') === (size || '')
    );

    if (existingLineIndex >= 0) {
      normalizedItems[existingLineIndex].quantity += qty;
    } else {
      normalizedItems.push({
        productId: pid,
        ...(variantId ? { variantId } : {}),
        ...(color ? { color } : {}),
        ...(size ? { size } : {}),
        title: dbProduct.title,
        price: unitPrice,
        quantity: qty,
        image: itemImage,
      });
    }
  }

  const trustedSubTotal = Math.round(
    normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  );

  // Calculate shipping charge from merchant's shipping zones or explicit merchant input
  const addressParts = (payload.shippingAddress || '').split(',').map((p: string) => p.trim());
  const district = addressParts[addressParts.length - 2] || '';
  const division = addressParts[addressParts.length - 1] || '';

  const theme = await Theme.findOne({ tenantId }).select('shippingZones defaultShippingCost').lean();
  const zones = theme?.shippingZones || [];
  const defaultCost = theme?.defaultShippingCost ?? 120;
  const { cost: zoneShippingCharge } = computeShipping(
    division,
    district,
    zones as any[],
    defaultCost
  );

  const finalShippingCharge =
    typeof payload.shippingCharge === 'number' && !isNaN(payload.shippingCharge) && payload.shippingCharge >= 0
      ? Math.round(payload.shippingCharge)
      : zoneShippingCharge;

  const safeDiscount = Math.min(
    trustedSubTotal,
    Math.max(0, Math.round(Number(payload.discount) || 0))
  );

  const isDeliveryChargePaid = Boolean(payload.isDeliveryChargePaid);
  const netProductAmount = Math.max(0, trustedSubTotal - safeDiscount);
  const finalTotalPrice = isDeliveryChargePaid
    ? netProductAmount
    : netProductAmount + finalShippingCharge;

  const newOrderId = await generateUniqueOrderId();

  const orderDoc = await Order.create({
    orderId: newOrderId,
    customerName: (payload.customerName || '').trim(),
    customerPhone: cleanPhone,
    ...(payload.customerEmail ? { customerEmail: payload.customerEmail.trim() } : {}),
    shippingAddress: (payload.shippingAddress || '').trim(),
    ...(payload.note ? { note: payload.note.trim() } : {}),
    items: normalizedItems,
    tenantId,
    subTotal: trustedSubTotal,
    discount: safeDiscount,
    shippingCharge: finalShippingCharge,
    totalPrice: finalTotalPrice,
    isDeliveryChargePaid,
    paymentStatus: payload.paymentStatus === 'paid' ? 'paid' : 'unpaid',
    status: 'pending',
    orderSourceType: 'manual',
    orderSource: payload.orderSource || 'Other',
    createdBy: userId,
  } as any);

  // Reuse existing customer record or create a new one scoped strictly to this tenant
  try {
    const existingCustomer = await Customer.findOne({
      phone: cleanPhone,
      tenantId,
    });

    if (existingCustomer) {
      const updateCustomerFields: Record<string, any> = {
        name: (payload.customerName || '').trim(),
        address: (payload.shippingAddress || '').trim(),
      };
      if (payload.customerEmail && payload.customerEmail.trim()) {
        updateCustomerFields.email = payload.customerEmail.trim();
      }
      await Customer.findByIdAndUpdate(existingCustomer._id, {
        $inc: { totalOrders: 1, totalSpent: finalTotalPrice },
        $set: updateCustomerFields,
      });
    } else {
      await Customer.create({
        name: (payload.customerName || '').trim(),
        phone: cleanPhone,
        address: (payload.shippingAddress || '').trim(),
        ...(payload.customerEmail?.trim() ? { email: payload.customerEmail.trim() } : {}),
        tenantId: tenantId as any,
        totalOrders: 1,
        totalSpent: finalTotalPrice,
      });
    }
  } catch (error) {
    console.error('Error upserting customer on manual order:', error);
  }

  return orderDoc;
};

const getOrdersByTenant = async (tenantId: string, query: any = {}) => {
  const { page, limit, skip } = paginationHelper(query.page, query.limit);
  
  const filter: any = { tenantId };
  
  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }

  if (query.orderSourceType && query.orderSourceType !== 'all') {
    if (query.orderSourceType === 'manual') {
      filter.orderSourceType = 'manual';
    } else if (query.orderSourceType === 'storefront') {
      filter.orderSourceType = { $in: ['storefront', null, undefined] };
    }
  }

  if (query.orderSource && query.orderSource !== 'all') {
    filter.orderSource = query.orderSource;
  }
  
  if (query.search) {
    // Optionally strip leading '#' from the search term if users search like "#123456"
    const searchTerm = query.search.replace(/^#/, '').trim();
    if (searchTerm) {
      filter.$or = [
        { orderId: { $regex: searchTerm, $options: 'i' } },
        { customerName: { $regex: searchTerm, $options: 'i' } },
        { customerPhone: { $regex: searchTerm, $options: 'i' } },
        { orderSource: { $regex: searchTerm, $options: 'i' } },
      ];
    }
  }

  const [data, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter)
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  };
};

const updateOrder = async (id: string, payload: Partial<IOrder>, tenantId: string) => {
  const order = await Order.findOne({ _id: id, tenantId });
  if (!order) return null;

  // Prevent manual status updates if the order is managed by a courier
  if (payload.status && payload.status !== order.status && order.consignmentId) {
    throw new CustomError(400, 'Status cannot be changed manually after the order has been forwarded to a courier.');
  }

  const oldStatus = order.status;
  const newStatus = payload.status || oldStatus;
  
  const isOldCompleted = ['confirmed', 'shipped', 'delivered'].includes(oldStatus);
  const isNewCompleted = ['confirmed', 'shipped', 'delivered'].includes(newStatus);
  
  // Check if items are being modified
  const itemsChanged = !!payload.items;

  // Pre-validate stock availability before deducting stock (when confirming an unconfirmed order or modifying items)
  if (isNewCompleted && (!isOldCompleted || itemsChanged)) {
    const targetItems = (payload.items || order.items) as any[];
    const productIds = Array.from(new Set(targetItems.map((it: any) => String(it.productId))));
    const dbProducts = await Product.find({ _id: { $in: productIds }, tenantId });
    const productMap = new Map<string, any>(dbProducts.map((p: any) => [p._id.toString(), p]));

    // Calculate old quantities per product/variant if order was already completed (so we account for stock that will be reverted)
    const oldProdQtyMap = new Map<string, number>();
    const oldVarQtyMap = new Map<string, number>();
    if (isOldCompleted) {
      for (const oldItem of order.items) {
        const pid = String(oldItem.productId);
        oldProdQtyMap.set(pid, (oldProdQtyMap.get(pid) || 0) + oldItem.quantity);
        if (oldItem.variantId || oldItem.color || oldItem.size) {
          const vKey = `${pid}_${oldItem.variantId || `${oldItem.color || ''}_${oldItem.size || ''}`}`;
          oldVarQtyMap.set(vKey, (oldVarQtyMap.get(vKey) || 0) + oldItem.quantity);
        }
      }
    }

    for (const item of targetItems) {
      const pid = String(item.productId);
      const dbProduct = productMap.get(pid);
      if (!dbProduct) {
        throw new CustomError(400, `Product "${item.title || pid}" no longer exists in your store.`);
      }

      const availableProdStock = (dbProduct.stock ?? 0) + (oldProdQtyMap.get(pid) || 0);
      if (availableProdStock < item.quantity) {
        throw new CustomError(
          400,
          `Cannot confirm order: "${dbProduct.title}" is out of stock (Available: ${availableProdStock}, Required: ${item.quantity}).`
        );
      }

      if (dbProduct.hasVariants && Array.isArray(dbProduct.variants) && dbProduct.variants.length > 0) {
        let matchedVariant: any = null;
        if (item.variantId) {
          matchedVariant = dbProduct.variants.find((v: any) => v._id?.toString() === String(item.variantId));
        }
        if (!matchedVariant && (item.color || item.size)) {
          matchedVariant = dbProduct.variants.find(
            (v: any) =>
              (!item.color || (v.color || '').toLowerCase() === item.color.toLowerCase()) &&
              (!item.size || (v.size || '').toLowerCase() === item.size.toLowerCase())
          );
        }
        if (matchedVariant) {
          const vKey = `${pid}_${matchedVariant._id?.toString() || `${item.color || ''}_${item.size || ''}`}`;
          const availableVarStock = (matchedVariant.stock ?? 0) + (oldVarQtyMap.get(vKey) || 0);
          if (availableVarStock < item.quantity) {
            const optLabel = [matchedVariant.color, matchedVariant.size].filter(Boolean).join(' / ');
            throw new CustomError(
              400,
              `Cannot confirm order: "${dbProduct.title}" (${optLabel}) is out of stock (Available: ${availableVarStock}, Required: ${item.quantity}).`
            );
          }
        }
      }
    }
  }

  // 1. Revert old stock if the order was completed AND (it is now cancelled/pending OR the items are changing)
  if (isOldCompleted && (!isNewCompleted || itemsChanged)) {
    try {
      for (const item of order.items) {
        let updateRes: any = null;
        if (item.variantId) {
          updateRes = await Product.updateOne(
            { _id: item.productId, 'variants._id': item.variantId } as any,
            { $inc: { 'variants.$.stock': item.quantity, stock: item.quantity, salesCount: -item.quantity } } as any
          );
        } else if (item.color || item.size) {
          const varQuery: any = { _id: item.productId };
          if (item.color) varQuery['variants.color'] = item.color;
          if (item.size) varQuery['variants.size'] = item.size;
          updateRes = await Product.updateOne(
            varQuery,
            { $inc: { 'variants.$.stock': item.quantity, stock: item.quantity, salesCount: -item.quantity } } as any
          );
        }

        // If no variant matched/updated (e.g. non-variant item or variant was deleted), update base product
        if (!updateRes || updateRes.matchedCount === 0) {
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { salesCount: -item.quantity, stock: item.quantity }
          });
        }
      }
    } catch (e) {
      console.error("Error reverting product counts:", e);
    }
  }

  // Perform the update
  const result = await Order.findOneAndUpdate({ _id: id, tenantId }, payload, { returnDocument: 'after' });

  // 2. Apply new stock if the order is now completed AND (it was previously not completed OR the items changed)
  if (result && isNewCompleted && (!isOldCompleted || itemsChanged)) {
    try {
      for (const item of result.items) {
        let updateRes: any = null;
        if (item.variantId) {
          updateRes = await Product.updateOne(
            { _id: item.productId, 'variants._id': item.variantId } as any,
            { $inc: { 'variants.$.stock': -item.quantity, stock: -item.quantity, salesCount: item.quantity } } as any
          );
        } else if (item.color || item.size) {
          const varQuery: any = { _id: item.productId };
          if (item.color) varQuery['variants.color'] = item.color;
          if (item.size) varQuery['variants.size'] = item.size;
          updateRes = await Product.updateOne(
            varQuery,
            { $inc: { 'variants.$.stock': -item.quantity, stock: -item.quantity, salesCount: item.quantity } } as any
          );
        }

        // If no variant matched/updated, update base product
        if (!updateRes || updateRes.matchedCount === 0) {
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { salesCount: item.quantity, stock: -item.quantity }
          });
        }
      }
    } catch (e) {
      console.error("Error updating product counts:", e);
    }
  }

  return result;
};

const deleteOrder = async (id: string, tenantId: string) => {
  const result = await Order.findOneAndDelete({ _id: id, tenantId });
  return result;
};

const getOrderById = async (id: string, tenantId?: string) => {
  const cleanId = id.replace(/^#/, '');
  
  let query: any = { orderId: cleanId };
  if (tenantId) query.tenantId = tenantId;
  
  const result = await Order.findOne(query);
  return result;
};

export const OrderService = {
  createOrder,
  createManualOrder,
  getOrdersByTenant,
  updateOrder,
  deleteOrder,
  getOrderById,
};
