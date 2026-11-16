import crypto from 'crypto';
import axios from 'axios';
import cron from 'node-cron';
import { Types } from 'mongoose';
import { TrackingConfig } from './tracking.model';
import { ITrackingConfig } from './tracking.interface';
import { TenantTrackingEvent, TenantMetaEventName } from './tenantTrackingEvent.model';
import { decryptSecretGCM } from '../../utils/encryption';
import { normalizeIp } from '../../utils/ipHelper';

export interface TenantTrackingUserContext {
  email?: string | undefined;
  phone?: string | undefined;
  name?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  externalId?: string | undefined;
  country?: string | undefined;
  clientIpAddress?: string | undefined;
  clientUserAgent?: string | undefined;
  fbp?: string | undefined;
  fbc?: string | undefined;
}

export interface TrackTenantEventInput {
  tenantId: string | Types.ObjectId;
  eventName: Exclude<TenantMetaEventName, 'TestEvent'>;
  eventId: string;
  eventTime?: number | undefined;
  eventSourceUrl?: string | undefined;
  user?: TenantTrackingUserContext | undefined;
  customData?: Record<string, any> | undefined;
}

export interface TrackTenantOrderPurchaseInput {
  order: any;
  trackingContext?: {
    eventId?: string | undefined;
    eventSourceUrl?: string | undefined;
    clientIpAddress?: string | undefined;
    clientUserAgent?: string | undefined;
    fbp?: string | undefined;
    fbc?: string | undefined;
  };
}

const DEFAULT_GRAPH_API_VERSION = 'v21.0';
const CONFIG_CACHE_TTL_MS = 30 * 1000;

interface CachedConfigEntry {
  doc: ITrackingConfig | null;
  expiresAt: number;
}

const tenantConfigCache = new Map<string, CachedConfigEntry>();

export const DEFAULT_MERCHANT_EVENTS = {
  PageView: true,
  ViewContent: true,
  AddToCart: true,
  InitiateCheckout: true,
  Purchase: true,
  Contact: true,
  CompleteRegistration: true,
  StartTrial: true,
};

const sha256 = (value: string): string =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const normalizeAndHashEmail = (email?: string): string[] | undefined => {
  if (!email || typeof email !== 'string') return undefined;
  const clean = email.trim().toLowerCase();
  if (!clean || !clean.includes('@')) return undefined;
  return [sha256(clean)];
};

const normalizeAndHashPhone = (phone?: string): string[] | undefined => {
  if (!phone || typeof phone !== 'string') return undefined;
  let digits = phone.replace(/\D/g, '');
  if (!digits) return undefined;

  // Normalize common Bangladesh formats to E.164 without '+'
  if (digits.startsWith('01') && digits.length === 11) {
    digits = `88${digits}`;
  } else if (digits.startsWith('1') && digits.length === 10) {
    digits = `880${digits}`;
  } else {
    digits = digits.replace(/^0+/, '');
  }

  if (digits.length < 7) return undefined;
  return [sha256(digits)];
};

const normalizeNameToken = (val?: string): string | undefined => {
  if (!val || typeof val !== 'string') return undefined;
  const clean = val
    .trim()
    .toLowerCase()
    .replace(/[^a-z\u0980-\u09ff\s]/gi, '')
    .trim();
  if (!clean) return undefined;
  return sha256(clean);
};

const splitNameAndHash = (user?: TenantTrackingUserContext) => {
  let fn = user?.firstName ? normalizeNameToken(user.firstName) : undefined;
  let ln = user?.lastName ? normalizeNameToken(user.lastName) : undefined;

  if ((!fn || !ln) && user?.name) {
    const parts = user.name.trim().split(/\s+/).filter(Boolean);
    if (!fn && parts[0]) fn = normalizeNameToken(parts[0]);
    if (!ln && parts.length > 1) ln = normalizeNameToken(parts.slice(1).join(' '));
  }

  return {
    ...(fn ? { fn: [fn] } : {}),
    ...(ln ? { ln: [ln] } : {}),
  };
};

const normalizeAndHashExternalId = (id?: string): string[] | undefined => {
  if (!id || typeof id !== 'string') return undefined;
  const clean = id.trim().toLowerCase();
  if (!clean) return undefined;
  return [sha256(clean)];
};

const normalizeAndHashCountry = (country = 'bd'): string[] | undefined => {
  const clean = (country || 'bd').trim().toLowerCase().slice(0, 2);
  if (clean.length !== 2) return undefined;
  return [sha256(clean)];
};

const isValidPublicIp = (ip?: string): string | undefined => {
  if (!ip || typeof ip !== 'string') return undefined;
  const normalized = normalizeIp(ip);
  if (!normalized) return undefined;
  if (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
};

const isValidMetaCookie = (value?: string): string | undefined => {
  if (!value || typeof value !== 'string') return undefined;
  const clean = value.trim();
  if (!clean.startsWith('fb.') || clean.length > 256) return undefined;
  return clean;
};

const sanitizeGraphApiVersion = (version?: string): string => {
  const clean = (version || '').trim();
  return /^v\d+\.\d+$/.test(clean) ? clean : DEFAULT_GRAPH_API_VERSION;
};

const sanitizeErrorMessage = (error: any): string => {
  const raw =
    error?.response?.data?.error?.error_user_msg ||
    error?.response?.data?.error?.message ||
    error?.message ||
    'Unknown Meta Graph API error';
  return String(raw).replace(/access_token=[^&\s]+/gi, 'access_token=[REDACTED]').slice(0, 400);
};

const buildUserData = (user?: TenantTrackingUserContext): Record<string, any> => {
  if (!user) {
    return {
      country: normalizeAndHashCountry('bd'),
    };
  }

  const em = normalizeAndHashEmail(user.email);
  const ph = normalizeAndHashPhone(user.phone);
  const { fn, ln } = splitNameAndHash(user);
  const externalId = normalizeAndHashExternalId(user.externalId);
  const country = normalizeAndHashCountry(user.country || 'bd');
  const validIp = isValidPublicIp(user.clientIpAddress);
  const validUa = user.clientUserAgent && user.clientUserAgent !== 'Unknown'
    ? String(user.clientUserAgent).slice(0, 512)
    : undefined;
  const validFbp = isValidMetaCookie(user.fbp);
  const validFbc = isValidMetaCookie(user.fbc);

  return {
    ...(em ? { em } : {}),
    ...(ph ? { ph } : {}),
    ...(fn ? { fn } : {}),
    ...(ln ? { ln } : {}),
    ...(externalId ? { external_id: externalId } : {}),
    ...(country ? { country } : {}),
    ...(validIp ? { client_ip_address: validIp } : {}),
    ...(validUa ? { client_user_agent: validUa } : {}),
    ...(validFbp ? { fbp: validFbp } : {}),
    ...(validFbc ? { fbc: validFbc } : {}),
  };
};

const sanitizeCustomData = (customData?: Record<string, any>): Record<string, any> => {
  if (!customData || typeof customData !== 'object') return {};
  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(customData)) {
    if (val !== undefined && val !== null && val !== '') {
      cleaned[key] = val;
    }
  }
  return cleaned;
};

const getTenantConfig = async (
  tenantId: string | Types.ObjectId,
  forceRefresh = false
): Promise<ITrackingConfig | null> => {
  const key = String(tenantId);
  const now = Date.now();
  const cached = tenantConfigCache.get(key);

  if (!forceRefresh && cached && now < cached.expiresAt) {
    return cached.doc;
  }

  const doc = await TrackingConfig.findOne({ tenantId, isPlatform: false }).lean<ITrackingConfig>();
  tenantConfigCache.set(key, { doc: doc || null, expiresAt: now + CONFIG_CACHE_TTL_MS });
  return doc || null;
};

const invalidateTenantConfigCache = async (tenantId: string | Types.ObjectId): Promise<void> => {
  tenantConfigCache.delete(String(tenantId));
};

const updateDiagnostics = async (
  tenantId: string | Types.ObjectId,
  patch: Record<string, any>
): Promise<void> => {
  try {
    const updateFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(patch)) {
      updateFields[`metaPixel.diagnostics.${key}`] = value;
    }
    await TrackingConfig.updateOne({ tenantId, isPlatform: false }, { $set: updateFields });
    await invalidateTenantConfigCache(tenantId);
  } catch {
    // Non-fatal diagnostic update
  }
};

const pruneOldTenantTrackingEvents = async (
  tenantId: string | Types.ObjectId,
  keepCount = 100
): Promise<number> => {
  try {
    const totalCount = await TenantTrackingEvent.countDocuments({ tenantId });
    if (totalCount <= keepCount) {
      return 0;
    }

    const latestEvents = await TenantTrackingEvent.find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(keepCount)
      .select('_id')
      .lean();

    const keepIds = latestEvents.map((e) => e._id);
    const deleteResult = await TenantTrackingEvent.deleteMany({
      tenantId,
      _id: { $nin: keepIds },
    });

    return deleteResult.deletedCount || 0;
  } catch (error) {
    console.error(`[TenantCAPI] Error pruning old tracking events for tenant ${tenantId}:`, error);
    return 0;
  }
};

const deliverTenantEvent = async (eventDocId: string): Promise<void> => {
  const eventDoc = await TenantTrackingEvent.findById(eventDocId);
  if (!eventDoc || eventDoc.status === 'sent' || eventDoc.status === 'skipped') {
    return;
  }

  const configDoc = await getTenantConfig(eventDoc.tenantId, true);
  const meta = configDoc?.metaPixel;

  if (!meta?.capiEnabled || !meta?.pixelId || !meta?.capiAccessTokenEncrypted) {
    eventDoc.status = 'skipped';
    eventDoc.errorMessage = 'Merchant CAPI is disabled or missing Pixel ID / Access Token';
    await eventDoc.save();
    return;
  }

  const rawToken = decryptSecretGCM(meta.capiAccessTokenEncrypted);
  if (!rawToken) {
    eventDoc.status = 'failed';
    eventDoc.errorMessage = 'Failed to decrypt Merchant CAPI access token';
    await eventDoc.save();
    await updateDiagnostics(eventDoc.tenantId, {
      lastEventAt: new Date(),
      lastEventName: eventDoc.eventName,
      lastEventStatus: 'failed',
      lastErrorMessage: eventDoc.errorMessage,
      lastErrorAt: new Date(),
    });
    return;
  }

  const apiVersion = sanitizeGraphApiVersion(meta.graphApiVersion);
  const endpoint = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(meta.pixelId)}/events`;

  const eventPayload: Record<string, any> = {
    event_name: eventDoc.eventName,
    event_time: eventDoc.eventTime,
    event_id: eventDoc.eventId,
    action_source: eventDoc.actionSource || 'website',
    user_data: eventDoc.userData || {},
  };

  if (eventDoc.eventSourceUrl) {
    eventPayload.event_source_url = eventDoc.eventSourceUrl;
  }
  if (eventDoc.customData && Object.keys(eventDoc.customData).length > 0) {
    eventPayload.custom_data = eventDoc.customData;
  }

  const requestBody: Record<string, any> = {
    data: [eventPayload],
  };

  const isTestMode = meta.mode ? meta.mode === 'test' : Boolean(meta.testEventCode?.trim());
  const testCode = (meta.testEventCode || '').trim();
  if (isTestMode && testCode) {
    requestBody.test_event_code = testCode;
  }

  eventDoc.attempts += 1;

  try {
    const response = await axios.post(endpoint, requestBody, {
      params: { access_token: rawToken },
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    const fbTraceId = (response.headers['x-fb-trace-id'] as string) || '';
    eventDoc.status = 'sent';
    eventDoc.httpStatus = response.status;
    eventDoc.fbTraceId = fbTraceId;
    eventDoc.errorMessage = '';
    eventDoc.sentAt = new Date();
    await eventDoc.save();

    await updateDiagnostics(eventDoc.tenantId, {
      lastEventAt: new Date(),
      lastEventName: eventDoc.eventName,
      lastEventStatus: 'sent',
      lastErrorMessage: '',
    });
  } catch (error: any) {
    const status = error?.response?.status;
    const sanitizedError = sanitizeErrorMessage(error);
    const fbTraceId = (error?.response?.headers?.['x-fb-trace-id'] as string) || '';

    eventDoc.httpStatus = status || 500;
    eventDoc.fbTraceId = fbTraceId;
    eventDoc.errorMessage = sanitizedError;

    // Fail immediately on client auth / pixel errors (4xx)
    if (status && status >= 400 && status < 500 && status !== 429) {
      eventDoc.status = 'failed';
    } else if (eventDoc.attempts >= eventDoc.maxAttempts) {
      eventDoc.status = 'failed';
    } else {
      eventDoc.status = 'retry_scheduled';
      const delayMinutes = Math.min(60, Math.pow(2, eventDoc.attempts) * 2);
      eventDoc.nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000);
    }

    await eventDoc.save();

    await updateDiagnostics(eventDoc.tenantId, {
      lastEventAt: new Date(),
      lastEventName: eventDoc.eventName,
      lastEventStatus: eventDoc.status === 'retry_scheduled' ? 'idle' : 'failed',
      lastErrorMessage: sanitizedError,
      lastErrorAt: new Date(),
    });
  }
};

const trackTenantEvent = async (
  input: TrackTenantEventInput
): Promise<{ queued: boolean; duplicate?: boolean; reason?: string; eventId: string }> => {
  const { tenantId, eventName, eventId, eventTime, eventSourceUrl, user, customData } = input;

  const configDoc = await getTenantConfig(tenantId);
  const meta = configDoc?.metaPixel;

  if (!meta?.capiEnabled || !meta?.pixelId || !meta?.capiAccessTokenEncrypted) {
    return { queued: false, reason: 'capi_disabled_or_unconfigured', eventId };
  }

  // Check event-level toggle (e.g. Purchase, AddToCart, ViewContent)
  const isEnabled = meta.events ? (meta.events as any)[eventName] !== false : true;
  if (!isEnabled) {
    return { queued: false, reason: 'event_toggle_disabled', eventId };
  }

  const cleanUserData = buildUserData(user);
  const cleanCustomData = sanitizeCustomData(customData);
  const timestamp = Number(eventTime) || Math.floor(Date.now() / 1000);

  try {
    const existing = await TenantTrackingEvent.findOne({ tenantId, eventName, eventId });
    if (existing) {
      return { queued: false, duplicate: true, eventId };
    }

    const created = await TenantTrackingEvent.create({
      tenantId,
      eventName,
      eventId,
      eventTime: timestamp,
      eventSourceUrl: eventSourceUrl || '',
      actionSource: 'website',
      userData: cleanUserData,
      customData: cleanCustomData,
      status: 'pending',
    });

    deliverTenantEvent(created._id.toString()).catch(() => undefined);
    pruneOldTenantTrackingEvents(tenantId, 100).catch(() => undefined);

    return { queued: true, eventId };
  } catch (err: any) {
    if (err?.code === 11000) {
      return { queued: false, duplicate: true, eventId };
    }
    return { queued: false, reason: 'enqueue_error', eventId };
  }
};

const trackTenantOrderPurchase = async (
  order: any,
  trackingContext?: {
    eventId?: string | undefined;
    eventSourceUrl?: string | undefined;
    clientIpAddress?: string | undefined;
    clientUserAgent?: string | undefined;
    fbp?: string | undefined;
    fbc?: string | undefined;
  }
): Promise<{ eventId: string; queued: boolean }> => {
  const tenantId = order?.tenantId;
  if (!tenantId) {
    return { eventId: '', queued: false };
  }

  const totalPrice = Number(order?.totalPrice || 0);
  const orderId = order?.orderId || String(order?._id);
  const deterministicEventId = trackingContext?.eventId || `order_${order?._id || orderId}`;

  const items = Array.isArray(order?.items) ? order.items : [];
  const contentIds = items.map((i: any) => String(i.productId || i._id)).filter(Boolean);
  const numItems = items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 1), 0);

  const res = await trackTenantEvent({
    tenantId,
    eventName: 'Purchase',
    eventId: deterministicEventId,
    eventSourceUrl: trackingContext?.eventSourceUrl || '',
    user: {
      name: order?.customerName,
      phone: order?.customerPhone,
      email: order?.customerEmail,
      clientIpAddress: trackingContext?.clientIpAddress,
      clientUserAgent: trackingContext?.clientUserAgent,
      fbp: trackingContext?.fbp,
      fbc: trackingContext?.fbc,
      country: 'bd',
    },
    customData: {
      content_type: 'product',
      content_ids: contentIds.length > 0 ? contentIds : undefined,
      num_items: numItems,
      value: totalPrice,
      currency: 'BDT',
      order_id: orderId,
    },
  });

  return { eventId: deterministicEventId, queued: res.queued };
};

const sendTestEvent = async (
  tenantId: string | Types.ObjectId,
  clientIp?: string,
  userAgent?: string,
  override?: { testEventCode?: string; graphApiVersion?: string; pixelId?: string }
): Promise<{
  success: boolean;
  message: string;
  eventsReceived?: number;
  fbTraceId?: string;
  httpStatus?: number;
}> => {
  const configDoc = await getTenantConfig(tenantId, true);
  const meta = configDoc?.metaPixel;

  const pixelId = (override?.pixelId || meta?.pixelId || '').trim();
  const apiVersion = sanitizeGraphApiVersion(override?.graphApiVersion || meta?.graphApiVersion);
  const rawToken = meta?.capiAccessTokenEncrypted
    ? decryptSecretGCM(meta.capiAccessTokenEncrypted)
    : '';
  const testCode = (override?.testEventCode ?? meta?.testEventCode ?? '').trim();

  if (!pixelId) {
    return { success: false, message: 'Meta Pixel ID is required before testing CAPI.' };
  }
  if (!rawToken) {
    return {
      success: false,
      message: 'Meta Conversions API Access Token is not configured. Please save a valid token first.',
    };
  }

  const testEventId = `test_tenant_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const validIp = isValidPublicIp(clientIp);
  const endpoint = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pixelId)}/events`;

  const body: Record<string, any> = {
    data: [
      {
        event_name: 'ViewContent',
        event_time: Math.floor(Date.now() / 1000),
        event_id: testEventId,
        action_source: 'website',
        user_data: {
          country: normalizeAndHashCountry('bd'),
          ...(validIp ? { client_ip_address: validIp } : {}),
          ...(userAgent ? { client_user_agent: String(userAgent).slice(0, 512) } : {}),
        },
        customData: {
          content_name: 'Merchant CAPI Integration Test',
          status: 'verified',
        },
      },
    ],
  };

  if (testCode) {
    body.test_event_code = testCode;
  }

  try {
    const response = await axios.post(endpoint, body, {
      params: { access_token: rawToken },
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    const fbTraceId = (response.headers['x-fb-trace-id'] as string) || '';
    const eventsReceived = response.data?.events_received || 1;

    await updateDiagnostics(tenantId, {
      lastTestAt: new Date(),
      lastTestStatus: 'success',
      lastTestMessage: `Test event accepted by Meta Graph API (${apiVersion})${testCode ? ` with Test Code "${testCode}"` : ''}.`,
      lastErrorMessage: '',
    });

    // Record test event in tenant tracking deliveries
    await TenantTrackingEvent.create({
      tenantId,
      eventName: 'TestEvent',
      eventId: testEventId,
      eventTime: Math.floor(Date.now() / 1000),
      actionSource: 'website',
      userData: { test: true },
      customData: { test_code: testCode, events_received: eventsReceived },
      status: 'sent',
      httpStatus: response.status,
      fbTraceId,
      sentAt: new Date(),
    }).catch(() => undefined);

    await pruneOldTenantTrackingEvents(tenantId, 100);

    return {
      success: true,
      message: `Test event delivered to Meta Graph API (${apiVersion})! Events Received: ${eventsReceived}. Check Meta Events Manager -> Test Events.`,
      eventsReceived,
      fbTraceId,
      httpStatus: response.status,
    };
  } catch (error: any) {
    const status = error?.response?.status;
    const sanitizedError = sanitizeErrorMessage(error);
    const fbTraceId = (error?.response?.headers?.['x-fb-trace-id'] as string) || '';

    await updateDiagnostics(tenantId, {
      lastTestAt: new Date(),
      lastTestStatus: 'failed',
      lastTestMessage: sanitizedError,
      lastErrorMessage: sanitizedError,
      lastErrorAt: new Date(),
    });

    return {
      success: false,
      message: sanitizedError,
      fbTraceId,
      httpStatus: status || 500,
    };
  }
};

const processTenantRetryQueue = async (): Promise<void> => {
  try {
    const dueEvents = await TenantTrackingEvent.find({
      status: 'retry_scheduled',
      nextRetryAt: { $lte: new Date() },
    })
      .limit(20)
      .select('_id tenantId')
      .lean();

    for (const evt of dueEvents) {
      await deliverTenantEvent(evt._id.toString());
    }
  } catch (error) {
    console.error('[TenantCAPI] Error processing retry queue:', error);
  }
};

export const initTenantCapiCron = (): void => {
  // Retry pending scheduled deliveries every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    processTenantRetryQueue().catch(() => undefined);
  });
};

export const TenantCapiService = {
  DEFAULT_MERCHANT_EVENTS,
  getTenantConfig,
  invalidateTenantConfigCache,
  pruneOldTenantTrackingEvents,
  trackTenantEvent,
  trackTenantOrderPurchase,
  sendTestEvent,
  initTenantCapiCron,
};
