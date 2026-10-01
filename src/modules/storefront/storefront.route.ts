import { Router } from 'express';
import { StorefrontController } from './storefront.controller';
import { TrackingController } from '../analytics/tracking.controller';
import { storefrontAuth } from '../../middlewares/storefrontAuth';
import { storefrontPublicLimiter, searchLimiter } from '../../middleware/rateLimiter';

const router = Router();

// Secure routes with storefront API key
router.use(storefrontAuth);

// ── Static / config endpoints (low traffic, but still protected)
router.get('/:tenantSlug/status', storefrontPublicLimiter, StorefrontController.getStatus);
router.get('/:tenantSlug/info', storefrontPublicLimiter, StorefrontController.getInfo);
router.get('/:tenantSlug/theme', storefrontPublicLimiter, StorefrontController.getTheme);
router.get('/:tenantSlug/tracking', storefrontPublicLimiter, TrackingController.getStorefrontTrackingConfig);
router.get('/:tenantSlug/categories', storefrontPublicLimiter, StorefrontController.getCategories);
router.get('/:tenantSlug/brands', storefrontPublicLimiter, StorefrontController.getBrands);

// ── Product listing / detail (high traffic — generous limit via storefrontPublicLimiter)
router.get('/:tenantSlug/products/bestsellers', storefrontPublicLimiter, StorefrontController.getBestsellingProducts);
router.get('/:tenantSlug/products/just-for-you', storefrontPublicLimiter, StorefrontController.getJustForYouProducts);
router.get('/:tenantSlug/products/:slug', storefrontPublicLimiter, StorefrontController.getProductBySlug);

// ── Search endpoint gets its own stricter (but still generous) limiter
// The frontend debounces for 1s, so real users fire max ~1 req/sec.
// searchLimiter allows 60 req/min — far more than any human needs.
router.get('/:tenantSlug/products', (req, res, next) => {
  // Apply tighter search limiter only when a search query is present
  if (req.query.search || req.query.query) {
    return searchLimiter(req, res, next);
  }
  return storefrontPublicLimiter(req, res, next);
}, StorefrontController.getProducts);

export const StorefrontRoutes = router;
