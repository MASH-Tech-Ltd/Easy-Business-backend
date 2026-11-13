import crypto from 'crypto';
import axios from 'axios';
import cron from 'node-cron';
import { TrackingConfig } from './tracking.model';
import { ITrackingConfig } from './tracking.interface';
import { PlatformTrackingEvent, PlatformMetaEventName } from './platformTrackingEvent.model';
import { decryptSecretGCM } from '../../utils/encryption';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../auth/auth.model';
import { normalizeIp } from '../../utils/ipHelper';

export interface PlatformTrackingUserContext {
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

export interface TrackPlatformEventInput {
  eventName: Exclude<PlatformMetaEventName, 'TestEvent'>;
  eventId: string;
  eventTime?: number | undefined;
  eventSourceUrl?: string | undefined;
  user?: PlatformTrackingUserContext | undefined;
  customData?: Record<string, any> | undefined;
}

export interface VerifiedSubscriptionPurchaseInput {
  subscriptionId: string;
  endDate: Date | string;
  invoiceNumber?: string | undefined;
  tenantId: string;
  packageName: string;
  packageId: string;
  paidAmount: number;
  userContext?: Partial<PlatformTrackingUserContext> | undefined;
}

const DEFAULT_GRAPH_API_VERSION = 'v21.0';
const CONFIG_CACHE_TTL_MS = 30 * 1000;

let cachedPlatformConfig: ITrackingConfig | null = null;
let cacheExpiresAt = 0;

const DEFAULT_EVENTS = {
  PageView: true,
  ViewContent: true,
  CompleteRegistration: true,
  StartTrial: true,
  InitiateCheckout: true,
  Purchase: true,
  Contact: true,
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

  // Normalize common Bangladesh local formats to E.164 digits without '+'
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

const splitNameAndHash = (user?: PlatformTrackingUserContext) => {
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
  // Strip any accidental query tokens from error text
  return String(raw).replace(/access_token=[^&\s]+/gi, 'access_token=[REDACTED]').slice(0, 400);
};

const buildUserData = (user?: PlatformTrackingUserContext): Record<string, any> => {
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

const getPlatformConfig = async (forceRefresh = false): Promise<ITrackingConfig | null> => {
  const now = Date.now();
  if (!forceRefresh && cachedPlatformConfig && now < cacheExpiresAt) {
    return cachedPlatformConfig;
  }

  const doc = await TrackingConfig.findOne({ isPlatform: true }).lean<ITrackingConfig>();
  cachedPlatformConfig = doc || null;
  cacheExpiresAt = now + CONFIG_CACHE_TTL_MS;
  return cachedPlatformConfig;
};

const invalidatePlatformConfigCache = async (): Promise<void> => {
  cachedPlatformConfig = null;
  cacheExpiresAt = 0;
};

const updateDiagnostics = async (patch: Record<string, any>): Promise<void> => {
  try {
    const updateFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(patch)) {
      updateFields[`metaPixel.diagnostics.${key}`] = value;
    }
    await TrackingConfig.updateOne({ isPlatform: true }, { $set: updateFields });
    await invalidatePlatformConfigCache();
  } catch {
    // Non-fatal diagnostic update
  }
};

const deliverEvent = async (eventDocId: string): Promise<void> => {
  const eventDoc = await PlatformTrackingEvent.findById(eventDocId);
  if (!eventDoc || eventDoc.status === 'sent' || eventDoc.status === 'skipped') {
    return;
  }

  const configDoc = await getPlatformConfig(true);
  const meta = configDoc?.metaPixel;

  if (!meta?.capiEnabled || !meta?.pixelId || !meta?.capiAccessTokenEncrypted) {
    eventDoc.status = 'skipped';
    eventDoc.errorMessage = 'Platform CAPI is disabled or missing Pixel ID / Access Token';
    await eventDoc.save();
    return;
  }

  const rawToken = decryptSecretGCM(meta.capiAccessTokenEncrypted);
  if (!rawToken) {
    eventDoc.status = 'failed';
    eventDoc.errorMessage = 'Failed to decrypt CAPI access token';
    await eventDoc.save();
    await updateDiagnostics({
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

  const testCode = (meta.testEventCode || '').trim();
  if (testCode) {
    requestBody.test_event_code = testCode;
  }

  eventDoc.attempts += 1;

  try {
    const response = await axios.post(endpoint, requestBody, {
      params: { access_token: rawToken },
      timeout: 10000,
    });

    eventDoc.status = 'sent';
    eventDoc.sentAt = new Date();
    eventDoc.httpStatus = response.status;
    eventDoc.fbTraceId = response.data?.fbtrace_id || '';
    eventDoc.errorMessage = '';
    eventDoc.nextRetryAt = null;
    await eventDoc.save();

    await updateDiagnostics({
      lastEventAt: eventDoc.sentAt,
      lastEventName: eventDoc.eventName,
      lastEventStatus: 'sent',
    });
  } catch (error: any) {
    const httpStatus = error?.response?.status;
    const message = sanitizeErrorMessage(error);
    const isRetryable = !httpStatus || httpStatus >= 500 || httpStatus === 429;

    eventDoc.httpStatus = httpStatus;
    eventDoc.errorMessage = message;

    if (isRetryable && eventDoc.attempts < eventDoc.maxAttempts) {
      const backoffMinutes = Math.pow(2, eventDoc.attempts);
      eventDoc.status = 'retry_scheduled';
      eventDoc.nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
    } else {
      eventDoc.status = 'failed';
      eventDoc.nextRetryAt = null;
    }

    await eventDoc.save();

    await updateDiagnostics({
      lastEventAt: new Date(),
      lastEventName: eventDoc.eventName,
      lastEventStatus: 'failed',
      lastErrorMessage: message,
      lastErrorAt: new Date(),
    });
  }
};

const trackPlatformEvent = async (
  input: TrackPlatformEventInput
): Promise<{ queued: boolean; duplicate?: boolean; reason?: string; eventId: string }> => {
  const { eventName, eventId, eventTime, eventSourceUrl, user, customData } = input;
  if (!eventName || !eventId) {
    return { queued: false, reason: 'missing_event_identifier', eventId: eventId || '' };
  }

  const configDoc = await getPlatformConfig();
  const meta = configDoc?.metaPixel;

  if (!meta?.capiEnabled || !meta?.pixelId || !meta?.capiAccessTokenEncrypted) {
    return { queued: false, reason: 'capi_disabled_or_unconfigured', eventId };
  }

  const eventsConfig = { ...DEFAULT_EVENTS, ...(meta.events || {}) };
  if (eventsConfig[eventName] === false) {
    return { queued: false, reason: 'event_disabled', eventId };
  }

  const normalizedEventTime = eventTime || Math.floor(Date.now() / 1000);
  const userData = buildUserData(user);
  const cleanedCustomData = sanitizeCustomData(customData);

  try {
    const existing = await PlatformTrackingEvent.findOne({ eventName, eventId });
    if (existing) {
      return { queued: false, duplicate: true, eventId };
    }

    const created = await PlatformTrackingEvent.create({
      eventName,
      eventId,
      eventTime: normalizedEventTime,
      eventSourceUrl: eventSourceUrl ? String(eventSourceUrl).slice(0, 1000) : '',
      actionSource: 'website',
      userData,
      customData: cleanedCustomData,
      status: 'pending',
    });

    setImmediate(() => {
      deliverEvent(created._id.toString()).catch(() => undefined);
    });

    return { queued: true, eventId };
  } catch (error: any) {
    // Handle duplicate key race cleanly (idempotency guarantee)
    if (error?.code === 11000) {
      return { queued: false, duplicate: true, eventId };
    }
    return { queued: false, reason: 'enqueue_error', eventId };
  }
};

const trackVerifiedSubscriptionPurchase = async (
  input: VerifiedSubscriptionPurchaseInput
): Promise<{ eventId: string; queued: boolean }> => {
  const {
    subscriptionId,
    endDate,
    invoiceNumber,
    tenantId,
    packageName,
    packageId,
    paidAmount,
    userContext,
  } = input;

  const numericAmount = Number(paidAmount || 0);
  const endTimestamp = new Date(endDate).getTime() || Date.now();
  const deterministicEventId = `purchase_sub_${subscriptionId}_${endTimestamp}`;

  if (numericAmount <= 0) {
    return { eventId: deterministicEventId, queued: false };
  }

  let email = userContext?.email;
  let phone = userContext?.phone;
  let name = userContext?.name;

  try {
    const tenant = await Tenant.findById(tenantId).lean();
    if (tenant) {
      email = email || (tenant as any).contactEmail;
      phone = phone || (tenant as any).contactPhone;
      name = name || (tenant as any).ownerName || (tenant as any).name;

      if ((tenant as any).ownerId) {
        const owner = await User.findById((tenant as any).ownerId).select('email phone name').lean();
        if (owner) {
          email = email || owner.email;
          phone = phone || (owner as any).phone;
          name = name || owner.name;
        }
      }
    }
  } catch {
    // Proceed with whatever context we have
  }

  const res = await trackPlatformEvent({
    eventName: 'Purchase',
    eventId: deterministicEventId,
    user: {
      ...userContext,
      email,
      phone,
      name,
      externalId: tenantId,
      country: 'bd',
    },
    customData: {
      content_name: packageName || 'MASH ECO Subscription',
      content_ids: packageId ? [String(packageId)] : undefined,
      content_type: 'product',
      value: numericAmount,
      currency: 'BDT',
      order_id: invoiceNumber || String(subscriptionId),
    },
  });

  return { eventId: deterministicEventId, queued: res.queued };
};

const sendTestEvent = async (
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
  const configDoc = await getPlatformConfig(true);
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

  const testEventId = `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const validIp = isValidPublicIp(clientIp);
  const endpoint = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pixelId)}/events`;

  const body: Record<string, any> = {
    data: [
      {
        event_name: 'ViewContent',
        event_time: Math.floor(Date.now() / 1000),
        event_id: testEventId,
        action_source: 'website',
        event_source_url: 'https://masheco.com',
        user_data: {
          country: normalizeAndHashCountry('bd'),
          ...(validIp ? { client_ip_address: validIp } : {}),
          ...(userAgent ? { client_user_agent: userAgent.slice(0, 512) } : {}),
        },
        custom_data: {
          content_name: 'MASH ECO CAPI Integration Test',
          currency: 'BDT',
          value: 0,
        },
      },
    ],
    ...(testCode ? { test_event_code: testCode } : {}),
  };

  try {
    const response = await axios.post(endpoint, body, {
      params: { access_token: rawToken },
      timeout: 12000,
    });

    const eventsReceived = Number(response.data?.events_received || 1);
    const fbTraceId = response.data?.fbtrace_id || '';
    const successMsg = testCode
      ? `Test event accepted by Meta Graph API (${apiVersion}) with Test Code "${testCode}".`
      : `Test event accepted by Meta Graph API (${apiVersion}). Add a Test Event Code to inspect it live in Events Manager -> Test Events.`;

    await updateDiagnostics({
      lastTestAt: new Date(),
      lastTestStatus: 'success',
      lastTestMessage: successMsg,
    });

    return {
      success: true,
      message: successMsg,
      eventsReceived,
      fbTraceId,
      httpStatus: response.status,
    };
  } catch (error: any) {
    const errMsg = sanitizeErrorMessage(error);
    await updateDiagnostics({
      lastTestAt: new Date(),
      lastTestStatus: 'failed',
      lastTestMessage: errMsg,
      lastErrorMessage: errMsg,
      lastErrorAt: new Date(),
    });

    return {
      success: false,
      message: errMsg,
      httpStatus: error?.response?.status,
    };
  }
};

const processPendingRetries = async (): Promise<void> => {
  try {
    const dueEvents = await PlatformTrackingEvent.find({
      status: 'retry_scheduled',
      nextRetryAt: { $lte: new Date() },
    })
      .sort({ nextRetryAt: 1 })
      .limit(25)
      .select('_id')
      .lean();

    for (const evt of dueEvents) {
      await deliverEvent(evt._id.toString());
    }
  } catch {
    // Retry tick error ignored so cron keeps running
  }
};

let cronStarted = false;
export const initPlatformCapiCron = (): void => {
  if (cronStarted) return;
  cronStarted = true;
  cron.schedule('* * * * *', () => {
    processPendingRetries().catch(() => undefined);
  });
};

export const PlatformCapiService = {
  DEFAULT_EVENTS,
  getPlatformConfig,
  invalidatePlatformConfigCache,
  trackPlatformEvent,
  trackVerifiedSubscriptionPurchase,
  sendTestEvent,
  processPendingRetries,
};
