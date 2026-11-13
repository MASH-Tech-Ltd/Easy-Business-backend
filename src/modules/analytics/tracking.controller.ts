import { Request, Response } from 'express';
import { TrackingConfig } from './tracking.model';
import { validateTrackingConfig } from './tracking.validation';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { Tenant } from '../tenant/tenant.model';

import CustomError from '../../helpers/CustomError';
import { User } from '../auth/auth.model';
import { Subscription } from '../subscription/subscription.model';
import { encryptSecretGCM, maskSecretToken } from '../../utils/encryption';
import { PlatformCapiService } from './platformCapi.service';
import { PlatformTrackingEvent } from './platformTrackingEvent.model';
import { SecurityLog } from '../system/security.model';
import { getClientIp } from '../../utils/ipHelper';

const sanitizePublicPlatformMetaPixel = (metaPixel: any) => ({
  enabled: Boolean(metaPixel?.enabled && metaPixel?.pixelId),
  pixelId: metaPixel?.enabled ? metaPixel?.pixelId || '' : '',
  capiEnabled: Boolean(metaPixel?.capiEnabled && metaPixel?.pixelId && metaPixel?.capiAccessTokenEncrypted),
  events: {
    PageView: metaPixel?.events?.PageView ?? true,
    ViewContent: metaPixel?.events?.ViewContent ?? true,
    CompleteRegistration: metaPixel?.events?.CompleteRegistration ?? true,
    StartTrial: metaPixel?.events?.StartTrial ?? true,
    InitiateCheckout: metaPixel?.events?.InitiateCheckout ?? true,
    Purchase: metaPixel?.events?.Purchase ?? true,
    Contact: metaPixel?.events?.Contact ?? true,
  },
});

const sanitizeAdminPlatformConfig = (configDoc: any) => {
  const plain = typeof configDoc?.toObject === 'function' ? configDoc.toObject() : { ...configDoc };
  const meta = plain.metaPixel || {};
  return {
    ...plain,
    metaPixel: {
      enabled: Boolean(meta.enabled),
      pixelId: meta.pixelId || '',
      capiEnabled: Boolean(meta.capiEnabled),
      hasCapiToken: Boolean(meta.capiAccessTokenEncrypted),
      capiTokenMasked: meta.capiTokenMasked || '',
      graphApiVersion: meta.graphApiVersion || 'v21.0',
      testEventCode: meta.testEventCode || '',
      events: {
        PageView: meta.events?.PageView ?? true,
        ViewContent: meta.events?.ViewContent ?? true,
        CompleteRegistration: meta.events?.CompleteRegistration ?? true,
        StartTrial: meta.events?.StartTrial ?? true,
        InitiateCheckout: meta.events?.InitiateCheckout ?? true,
        Purchase: meta.events?.Purchase ?? true,
        Contact: meta.events?.Contact ?? true,
      },
      diagnostics: {
        lastTestAt: meta.diagnostics?.lastTestAt || null,
        lastTestStatus: meta.diagnostics?.lastTestStatus || 'idle',
        lastTestMessage: meta.diagnostics?.lastTestMessage || '',
        lastEventAt: meta.diagnostics?.lastEventAt || null,
        lastEventName: meta.diagnostics?.lastEventName || '',
        lastEventStatus: meta.diagnostics?.lastEventStatus || 'idle',
        lastErrorMessage: meta.diagnostics?.lastErrorMessage || '',
        lastErrorAt: meta.diagnostics?.lastErrorAt || null,
      },
    },
  };
};

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
  const prefixOnly = bare.replace(/\.masheco\.com$/, '');
  const withMasheco = `${prefixOnly}.masheco.com`;
  return {
    $or: [
      { domain: bare },
      { domain: prefixOnly },
      { domain: withMasheco },
      { slug: bare },
      { slug: prefixOnly },
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

  // ENFORCE PLAN TIER AUTHORIZATION: Prevent Free/Basic plans from accessing paid tracking features
  const subscription = await Subscription.findOne({ tenantId, status: 'active' }).populate('packageId');
  if (!subscription) {
    throw new CustomError(403, 'An active subscription is required to configure tracking integrations. Please subscribe to a plan.');
  }

  const pkg = subscription.packageId as any;
  const planName = (pkg?.name || '').toLowerCase().trim();
  const isTrial = Boolean(subscription.isTrial);

  const wantsGA = Boolean(googleAnalytics?.enabled);
  const wantsPixel = Boolean(metaPixel?.enabled);
  const wantsGTM = Boolean(googleTagManager?.enabled);

  if (isTrial && (wantsGA || wantsPixel || wantsGTM)) {
    throw new CustomError(
      403,
      'Native tracking integrations (GA4, Meta Pixel, and GTM) are paid features and are not included in the Free Trial. Please upgrade to Standard or Premium.'
    );
  }

  if (planName.includes('basic') && (wantsGA || wantsPixel || wantsGTM)) {
    throw new CustomError(
      403,
      'Google Analytics 4 and Meta Pixel native integrations require a Standard or Premium plan. Please upgrade your plan to unlock them.'
    );
  }

  if (planName.includes('standard') && wantsGTM) {
    throw new CustomError(
      403,
      'Google Tag Manager multi-channel tracking is a Premium feature. Please upgrade to the Premium plan to activate GTM.'
    );
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
      metaPixel: {
        enabled: false,
        pixelId: '',
        capiEnabled: false,
        capiAccessTokenEncrypted: '',
        capiTokenMasked: '',
        graphApiVersion: 'v21.0',
        testEventCode: '',
        events: { ...PlatformCapiService.DEFAULT_EVENTS },
      },
      googleTagManager: { enabled: false, containerId: '' },
    });
  }

  const recentEvents = await PlatformTrackingEvent.find()
    .sort({ createdAt: -1 })
    .limit(15)
    .select('eventName eventId status attempts httpStatus fbTraceId errorMessage sentAt createdAt')
    .lean();

  ApiResponse.sendSuccess(res, 200, 'Platform tracking configuration retrieved successfully', {
    ...sanitizeAdminPlatformConfig(configDoc),
    recentEvents,
  });
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

  let tokenChanged = false;
  let tokenCleared = false;

  if (metaPixel) {
    const existingMeta = configDoc.metaPixel || ({} as any);
    let nextEncryptedToken = existingMeta.capiAccessTokenEncrypted || '';
    let nextMaskedToken = existingMeta.capiTokenMasked || '';

    const rawIncomingToken = typeof metaPixel.capiAccessToken === 'string' ? metaPixel.capiAccessToken.trim() : '';

    if (metaPixel.clearCapiToken === true) {
      nextEncryptedToken = '';
      nextMaskedToken = '';
      tokenCleared = true;
    } else if (rawIncomingToken && !rawIncomingToken.includes('••••')) {
      nextEncryptedToken = encryptSecretGCM(rawIncomingToken);
      nextMaskedToken = maskSecretToken(rawIncomingToken);
      tokenChanged = true;
    }

    const incomingEvents = (metaPixel.events || {}) as Record<string, boolean | undefined>;
    const existingEvents = (existingMeta.events || {}) as Record<string, boolean | undefined>;

    configDoc.metaPixel = {
      enabled: Boolean(metaPixel.enabled),
      pixelId: (metaPixel.pixelId || '').trim(),
      capiEnabled: Boolean(metaPixel.capiEnabled),
      capiAccessTokenEncrypted: nextEncryptedToken,
      capiTokenMasked: nextMaskedToken,
      graphApiVersion: (metaPixel.graphApiVersion || existingMeta.graphApiVersion || 'v21.0').trim(),
      testEventCode:
        metaPixel.testEventCode !== undefined
          ? String(metaPixel.testEventCode).trim()
          : existingMeta.testEventCode || '',
      events: {
        PageView: incomingEvents.PageView ?? existingEvents.PageView ?? true,
        ViewContent: incomingEvents.ViewContent ?? existingEvents.ViewContent ?? true,
        CompleteRegistration: incomingEvents.CompleteRegistration ?? existingEvents.CompleteRegistration ?? true,
        StartTrial: incomingEvents.StartTrial ?? existingEvents.StartTrial ?? true,
        InitiateCheckout: incomingEvents.InitiateCheckout ?? existingEvents.InitiateCheckout ?? true,
        Purchase: incomingEvents.Purchase ?? existingEvents.Purchase ?? true,
        Contact: incomingEvents.Contact ?? existingEvents.Contact ?? true,
      },
      diagnostics: existingMeta.diagnostics || {
        lastTestAt: null,
        lastTestStatus: 'idle',
        lastTestMessage: '',
        lastEventAt: null,
        lastEventName: '',
        lastEventStatus: 'idle',
        lastErrorMessage: '',
        lastErrorAt: null,
      },
    };
  }

  if (googleTagManager) {
    configDoc.googleTagManager = {
      enabled: Boolean(googleTagManager.enabled),
      containerId: (googleTagManager.containerId || '').trim(),
    };
  }

  await configDoc.save();
  await PlatformCapiService.invalidatePlatformConfigCache();

  // Audit log sensitive platform tracking configuration updates
  try {
    const adminUser = (req as any).user;
    await SecurityLog.create({
      incidentType: 'PLATFORM_TRACKING_CONFIG_UPDATED',
      endpoint: '/api/v1/tracking/platform',
      ipAddress: getClientIp(req),
      reason: `Pixel:${Boolean(configDoc.metaPixel?.enabled)}, CAPI:${Boolean(configDoc.metaPixel?.capiEnabled)}, TokenUpdated:${tokenChanged}, TokenCleared:${tokenCleared}`,
      requestedFrom: 'Super Admin',
      user: adminUser?.email || adminUser?._id?.toString() || 'super_admin',
      userAgent: (req.headers['user-agent'] as string) || 'Unknown',
    });
  } catch {
    // Audit failure must not block configuration save
  }

  ApiResponse.sendSuccess(
    res,
    200,
    'Platform tracking configuration updated successfully',
    sanitizeAdminPlatformConfig(configDoc)
  );
});

// 5B. Public Platform Tracking Config Endpoint (Used ONLY by MASH ECO Platform Next.js App)
const getPublicPlatformTrackingConfig = asyncHandler(async (req: Request, res: Response) => {
  const platformConfig = await PlatformCapiService.getPlatformConfig();
  ApiResponse.sendSuccess(res, 200, 'Public platform tracking config retrieved', {
    googleAnalytics: platformConfig?.googleAnalytics?.enabled
      ? platformConfig.googleAnalytics
      : { enabled: false, measurementId: '' },
    metaPixel: sanitizePublicPlatformMetaPixel(platformConfig?.metaPixel),
    googleTagManager: platformConfig?.googleTagManager?.enabled
      ? platformConfig.googleTagManager
      : { enabled: false, containerId: '' },
    isPlatform: true,
  });
});

// 5C. Public Platform Browser-to-CAPI Forwarding (Only PageView & ViewContent for Deduplication)
const trackPlatformBrowserEvent = asyncHandler(async (req: Request, res: Response) => {
  const { eventName, eventId, eventSourceUrl, fbp, fbc, customData } = req.body;

  const result = await PlatformCapiService.trackPlatformEvent({
    eventName,
    eventId,
    eventSourceUrl: eventSourceUrl || (req.headers.referer as string) || '',
    user: {
      clientIpAddress: getClientIp(req),
      clientUserAgent: (req.headers['user-agent'] as string) || '',
      fbp,
      fbc,
      country: 'bd',
    },
    customData,
  });

  ApiResponse.sendSuccess(res, 200, 'Platform event processed', result);
});

// 5D. Super Admin Test CAPI Event Connection
const testPlatformMetaCapi = asyncHandler(async (req: Request, res: Response) => {
  const { testEventCode, graphApiVersion, pixelId } = req.body || {};
  const result = await PlatformCapiService.sendTestEvent(
    getClientIp(req),
    (req.headers['user-agent'] as string) || '',
    { testEventCode, graphApiVersion, pixelId }
  );

  try {
    const adminUser = (req as any).user;
    await SecurityLog.create({
      incidentType: 'PLATFORM_TRACKING_TEST_CAPI',
      endpoint: '/api/v1/tracking/platform/test-capi',
      ipAddress: getClientIp(req),
      reason: `Test status: ${result.success ? 'SUCCESS' : 'FAILED'} (${result.message})`,
      requestedFrom: 'Super Admin',
      user: adminUser?.email || adminUser?._id?.toString() || 'super_admin',
      userAgent: (req.headers['user-agent'] as string) || 'Unknown',
    });
  } catch {
    // Non-fatal
  }

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message,
      data: result,
    });
  }

  ApiResponse.sendSuccess(res, 200, result.message, result);
});

// 6. Public Storefront Tracking Endpoint (Used by Tenant App)
const getStorefrontTrackingConfig = asyncHandler(async (req: Request, res: Response) => {
  const tenantSlug = req.params.tenantSlug as string;

  if (tenantSlug === 'main') {
    // Return Sanitized Platform tracking configuration ONLY for main landing page
    const platformConfig = await TrackingConfig.findOne({ isPlatform: true });
    return ApiResponse.sendSuccess(res, 200, 'Platform tracking active', {
      googleAnalytics: platformConfig?.googleAnalytics?.enabled ? platformConfig.googleAnalytics : { enabled: false, measurementId: '' },
      metaPixel: sanitizePublicPlatformMetaPixel(platformConfig?.metaPixel),
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

  // Verify merchant's active plan permissions before serving tracking IDs on public storefront
  const subscription = await Subscription.findOne({ tenantId: tenant._id, status: 'active' }).populate('packageId');
  const pkg = subscription?.packageId as any;
  const planName = (pkg?.name || '').toLowerCase().trim();
  const isTrial = Boolean(subscription?.isTrial);

  const allowGAandPixel = Boolean(subscription && !isTrial && (planName.includes('standard') || planName.includes('premium')));
  const allowGTM = Boolean(subscription && !isTrial && planName.includes('premium'));

  // STRICT SEPARATION: Platform tracking IDs MUST NEVER be returned for merchant storefronts!
  ApiResponse.sendSuccess(res, 200, 'Storefront tracking retrieved', {
    googleAnalytics: (allowGAandPixel && merchantConfig?.googleAnalytics?.enabled) ? merchantConfig.googleAnalytics : { enabled: false, measurementId: '' },
    metaPixel: (allowGAandPixel && merchantConfig?.metaPixel?.enabled) ? merchantConfig.metaPixel : { enabled: false, pixelId: '' },
    googleTagManager: (allowGTM && merchantConfig?.googleTagManager?.enabled) ? merchantConfig.googleTagManager : { enabled: false, containerId: '' },
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
  getPublicPlatformTrackingConfig,
  trackPlatformBrowserEvent,
  testPlatformMetaCapi,
  getStorefrontTrackingConfig,
};
