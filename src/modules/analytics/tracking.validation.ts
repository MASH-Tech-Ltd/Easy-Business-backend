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
    const { enabled, pixelId } = data.metaPixel;
    if (enabled && pixelId) {
      const clean = pixelId.trim();
      if (!/^\d{5,20}$/.test(clean)) {
        errors.metaPixel = 'Invalid Meta Pixel ID format (should be numeric, e.g. 1234567890)';
      }
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
