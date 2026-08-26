import { Router } from 'express';
import { StorefrontController } from './storefront.controller';

const router = Router();

// Public routes, no auth middleware required
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
