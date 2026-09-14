import { Router } from 'express';
import { StorefrontController } from './storefront.controller';

import { storefrontAuth } from '../../middlewares/storefrontAuth';

const router = Router();
import { globalRateLimiter } from '../../middleware/rateLimiter';

// Apply rate limiting to all public storefront routes
router.use(globalRateLimiter);

// Secure routes with API key
router.use(storefrontAuth);

router.get('/:tenantSlug/status', StorefrontController.getStatus);
router.get('/:tenantSlug/info', StorefrontController.getInfo);
router.get('/:tenantSlug/theme', StorefrontController.getTheme);
router.get('/:tenantSlug/products', StorefrontController.getProducts);
router.get('/:tenantSlug/products/bestsellers', StorefrontController.getBestsellingProducts);
router.get('/:tenantSlug/products/just-for-you', StorefrontController.getJustForYouProducts);
router.get('/:tenantSlug/products/:slug', StorefrontController.getProductBySlug);
router.get('/:tenantSlug/categories', StorefrontController.getCategories);
router.get('/:tenantSlug/brands', StorefrontController.getBrands);

export const StorefrontRoutes = router;
