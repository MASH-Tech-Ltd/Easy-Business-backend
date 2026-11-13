import { z } from 'zod';

export const validateTrackingConfig = (data: any) => {
  const errors: Record<string, string> = {};

  if (data?.googleAnalytics) {
    const { enabled, measurementId } = data.googleAnalytics;
    if (enabled && measurementId) {
      const clean = measurementId.trim();
      if (!/^G-[A-Z0-9]+$/i.test(clean) && !/^UA-\d+-\d+$/i.test(clean)) {
        errors.googleAnalytics = 'Invalid GA4 Measurement ID format (e.g. G-XXXXXXXXXX)';
      }
    }
  }

  if (data?.metaPixel) {
    const { enabled, capiEnabled, pixelId, graphApiVersion, testEventCode, capiAccessToken } = data.metaPixel;
    if ((enabled || capiEnabled) && pixelId) {
      const clean = String(pixelId).trim();
      if (!/^\d{5,20}$/.test(clean)) {
        errors.metaPixel = 'Invalid Meta Pixel ID format (should be numeric, e.g. 1234567890)';
      }
    }
    if (enabled && (!pixelId || !String(pixelId).trim())) {
      errors.metaPixel = 'Meta Pixel ID is required when Pixel is enabled';
    }
    if (capiEnabled && (!pixelId || !String(pixelId).trim())) {
      errors.metaPixel = 'Meta Pixel ID is required when CAPI is enabled';
    }
    if (graphApiVersion && !/^v\d+\.\d+$/.test(String(graphApiVersion).trim())) {
      errors.graphApiVersion = 'Invalid Meta Graph API version format (e.g. v21.0)';
    }
    if (testEventCode && String(testEventCode).trim().length > 64) {
      errors.testEventCode = 'Test Event Code must be 64 characters or less';
    }
    if (capiAccessToken && String(capiAccessToken).trim().length > 512) {
      errors.capiAccessToken = 'CAPI Access Token exceeds maximum length';
    }
  }

  if (data?.googleTagManager) {
    const { enabled, containerId } = data.googleTagManager;
    if (enabled && containerId) {
      const clean = containerId.trim();
      if (!/^GTM-[A-Z0-9]+$/i.test(clean)) {
        errors.googleTagManager = 'Invalid GTM Container ID format (e.g. GTM-XXXXXXX)';
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const trackPlatformBrowserEventSchema = z.object({
  body: z.object({
    eventName: z.enum(['PageView', 'ViewContent']),
    eventId: z.string().trim().min(4).max(128),
    eventSourceUrl: z.string().trim().max(1000).optional(),
    fbp: z.string().trim().max(256).optional(),
    fbc: z.string().trim().max(256).optional(),
    customData: z.record(z.string(), z.any()).optional(),
  }),
});
