import { Request, Response } from 'express';
import { TrackingConfig } from './tracking.model';
import { validateTrackingConfig } from './tracking.validation';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { Tenant } from '../tenant/tenant.model';

import CustomError from '../../helpers/CustomError';
import { User } from '../auth/auth.model';

// Helper to resolve tenantId from authenticated user request
const resolveUserTenantId = async (req: Request) => {
  let tenantId = (req.user as any)?.tenantId;
  if (!tenantId && (req.user as any)?._id) {
    const userDoc = await User.findById((req.user as any)._id);
    tenantId = userDoc?.tenantId;
  }
  if (!tenantId) {
    throw new CustomError(403, 'Tenant access denied or tenant ID missing');
  }
  return tenantId;
};

// Helper to normalize tenant query (matching storefront.controller.ts)
const normalizeTenantQuery = (slugOrDomain: string) => {
  const bare = slugOrDomain.replace(/^www\./, '').toLowerCase();
  const withWww = `www.${bare}`;
  return {
    $or: [
      { slug: bare },
      { customDomain: bare },
      { customDomain: withWww },
    ],
  };
};

// 1. Get Merchant Tracking Config (Merchant Dashboard)
const getMerchantTrackingConfig = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = await resolveUserTenantId(req);
  let configDoc = await TrackingConfig.findOne({ tenantId });

  if (!configDoc) {
    configDoc = await TrackingConfig.create({
      tenantId,
      isPlatform: false,
      googleAnalytics: { enabled: false, measurementId: '' },
      metaPixel: { enabled: false, pixelId: '' },
      googleTagManager: { enabled: false, containerId: '' },
    });
  }

  ApiResponse.sendSuccess(res, 200, 'Tracking configuration retrieved successfully', configDoc);
});

// 2. Update Merchant Tracking Config (Merchant Dashboard)
const updateMerchantTrackingConfig = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = await resolveUserTenantId(req);
  const { googleAnalytics, metaPixel, googleTagManager } = req.body;

  const validation = validateTrackingConfig({ googleAnalytics, metaPixel, googleTagManager });
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validation.errors,
    });
  }

  let configDoc = await TrackingConfig.findOne({ tenantId });
  if (!configDoc) {
    configDoc = new TrackingConfig({ tenantId, isPlatform: false });
  }

  if (googleAnalytics) {
    configDoc.googleAnalytics = {
      enabled: Boolean(googleAnalytics.enabled),
      measurementId: (googleAnalytics.measurementId || '').trim(),
    };
  }

  if (metaPixel) {
    configDoc.metaPixel = {
      enabled: Boolean(metaPixel.enabled),
      pixelId: (metaPixel.pixelId || '').trim(),
    };
  }

  if (googleTagManager) {
    configDoc.googleTagManager = {
      enabled: Boolean(googleTagManager.enabled),
      containerId: (googleTagManager.containerId || '').trim(),
    };
  }

  await configDoc.save();

  ApiResponse.sendSuccess(res, 200, 'Tracking configuration updated successfully', configDoc);
});

// 3. Test/Verify Merchant Tracking Config (Merchant Dashboard)
const testMerchantTrackingConfig = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = await resolveUserTenantId(req);
  const configDoc = await TrackingConfig.findOne({ tenantId });

  const status = {
    googleAnalytics: configDoc?.googleAnalytics?.enabled && configDoc?.googleAnalytics?.measurementId ? 'Connected' : configDoc?.googleAnalytics?.measurementId ? 'Disabled' : 'Not Configured',
    metaPixel: configDoc?.metaPixel?.enabled && configDoc?.metaPixel?.pixelId ? 'Connected' : configDoc?.metaPixel?.pixelId ? 'Disabled' : 'Not Configured',
    googleTagManager: configDoc?.googleTagManager?.enabled && configDoc?.googleTagManager?.containerId ? 'Connected' : configDoc?.googleTagManager?.containerId ? 'Disabled' : 'Not Configured',
  };

  ApiResponse.sendSuccess(res, 200, 'Tracking configuration status verified', status);
});

// 4. Get Platform Tracking Config (Super Admin Dashboard)
const getPlatformTrackingConfig = asyncHandler(async (req: Request, res: Response) => {
  let configDoc = await TrackingConfig.findOne({ isPlatform: true });

  if (!configDoc) {
    configDoc = await TrackingConfig.create({
      isPlatform: true,
      googleAnalytics: { enabled: false, measurementId: '' },
      metaPixel: { enabled: false, pixelId: '' },
      googleTagManager: { enabled: false, containerId: '' },
    });
  }

  ApiResponse.sendSuccess(res, 200, 'Platform tracking configuration retrieved successfully', configDoc);
});

// 5. Update Platform Tracking Config (Super Admin Dashboard)
const updatePlatformTrackingConfig = asyncHandler(async (req: Request, res: Response) => {
  const { googleAnalytics, metaPixel, googleTagManager } = req.body;

  const validation = validateTrackingConfig({ googleAnalytics, metaPixel, googleTagManager });
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validation.errors,
    });
  }

  let configDoc = await TrackingConfig.findOne({ isPlatform: true });
  if (!configDoc) {
    configDoc = new TrackingConfig({ isPlatform: true });
  }

  if (googleAnalytics) {
    configDoc.googleAnalytics = {
      enabled: Boolean(googleAnalytics.enabled),
      measurementId: (googleAnalytics.measurementId || '').trim(),
    };
  }

  if (metaPixel) {
    configDoc.metaPixel = {
      enabled: Boolean(metaPixel.enabled),
      pixelId: (metaPixel.pixelId || '').trim(),
    };
  }

  if (googleTagManager) {
    configDoc.googleTagManager = {
      enabled: Boolean(googleTagManager.enabled),
      containerId: (googleTagManager.containerId || '').trim(),
    };
  }

  await configDoc.save();

  ApiResponse.sendSuccess(res, 200, 'Platform tracking configuration updated successfully', configDoc);
});

// 6. Public Storefront Tracking Endpoint (Used by Tenant App)
const getStorefrontTrackingConfig = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;

  if (tenantSlug === 'main') {
    // Return Platform tracking configuration ONLY for main landing page
    const platformConfig = await TrackingConfig.findOne({ isPlatform: true });
    return ApiResponse.sendSuccess(res, 200, 'Platform tracking active', {
      googleAnalytics: platformConfig?.googleAnalytics?.enabled ? platformConfig.googleAnalytics : { enabled: false, measurementId: '' },
      metaPixel: platformConfig?.metaPixel?.enabled ? platformConfig.metaPixel : { enabled: false, pixelId: '' },
      googleTagManager: platformConfig?.googleTagManager?.enabled ? platformConfig.googleTagManager : { enabled: false, containerId: '' },
      isPlatform: true,
    });
  }

  // Resolve merchant tenant
  const query = normalizeTenantQuery(tenantSlug);
  const tenant = await Tenant.findOne({ ...query, status: 'active' });

  if (!tenant) {
    return ApiResponse.sendSuccess(res, 200, 'Storefront tracking not found', {
      googleAnalytics: { enabled: false, measurementId: '' },
      metaPixel: { enabled: false, pixelId: '' },
      googleTagManager: { enabled: false, containerId: '' },
      isPlatform: false,
    });
  }

  const merchantConfig = await TrackingConfig.findOne({ tenantId: tenant._id });

  // STRICT SEPARATION: Platform tracking IDs MUST NEVER be returned for merchant storefronts!
  ApiResponse.sendSuccess(res, 200, 'Storefront tracking retrieved', {
    googleAnalytics: merchantConfig?.googleAnalytics?.enabled ? merchantConfig.googleAnalytics : { enabled: false, measurementId: '' },
    metaPixel: merchantConfig?.metaPixel?.enabled ? merchantConfig.metaPixel : { enabled: false, pixelId: '' },
    googleTagManager: merchantConfig?.googleTagManager?.enabled ? merchantConfig.googleTagManager : { enabled: false, containerId: '' },
    isPlatform: false,
    tenantId: tenant._id,
  });
});

export const TrackingController = {
  getMerchantTrackingConfig,
  updateMerchantTrackingConfig,
  testMerchantTrackingConfig,
  getPlatformTrackingConfig,
  updatePlatformTrackingConfig,
  getStorefrontTrackingConfig,
};
