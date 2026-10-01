import { z } from 'zod';

export const assignPackageValidation = z.object({
  body: z.object({
    tenantId: z.string({ message: 'tenantId is required' }).min(1, 'tenantId cannot be empty'),
    packageId: z.string({ message: 'packageId is required' }).min(1, 'packageId cannot be empty'),
  }),
});

export const requestPackageValidation = z.object({
  body: z.object({
    packageId: z.string({ message: 'packageId is required' }).min(1, 'packageId cannot be empty'),
  }),
});

export const purchaseAddonValidation = z.object({
  body: z.object({
    addonId: z.string({ message: 'addonId is required' }).min(1, 'addonId cannot be empty'),
  }),
});

export const extendAddonLimitValidation = z.object({
  params: z.object({
    subscriptionId: z.string({ message: 'subscriptionId is required' }).min(1),
    addonId: z.string({ message: 'addonId is required' }).min(1),
  }),
  body: z.object({
    extraLimit: z.number().positive('extraLimit must be a positive number').optional(),
    limit: z.number().positive('limit must be a positive number').optional(),
  }),
});

export const subscriptionIdParamValidation = z.object({
  params: z.object({
    id: z.string({ message: 'ID is required' }).min(1, 'ID cannot be empty'),
  }),
});

export const tenantIdParamValidation = z.object({
  params: z.object({
    tenantId: z.string({ message: 'tenantId is required' }).min(1, 'tenantId cannot be empty'),
  }),
});

export const addonActionParamValidation = z.object({
  params: z.object({
    subscriptionId: z.string({ message: 'subscriptionId is required' }).min(1),
    addonId: z.string({ message: 'addonId is required' }).min(1),
  }),
});

export const updateSubscriptionValidation = z.object({
  params: z.object({
    id: z.string({ message: 'ID is required' }).min(1),
  }),
  body: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: z.enum(['active', 'expired', 'cancelled', 'pending']).optional(),
  }),
});

export const SubscriptionValidation = {
  assignPackageValidation,
  requestPackageValidation,
  purchaseAddonValidation,
  extendAddonLimitValidation,
  subscriptionIdParamValidation,
  tenantIdParamValidation,
  addonActionParamValidation,
  updateSubscriptionValidation,
};
