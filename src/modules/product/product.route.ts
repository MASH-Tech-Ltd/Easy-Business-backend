import { Router } from 'express';
import { ProductController } from './product.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { upload } from '../../middleware/multer.middleware';
import { uploadLimiter, dashboardLimiter, storefrontPublicLimiter } from '../../middleware/rateLimiter';
import { validateRequest } from '../../middleware/validateRequest';
import { ProductValidation } from './product.validation';

const router = Router();

router.post('/create-product', authMiddleware('tenant_admin'), uploadLimiter, upload.array('images', 4), validateRequest(ProductValidation.createProductValidation), ProductController.createProduct);
router.get('/check-limit', authMiddleware('tenant_admin'), dashboardLimiter, ProductController.checkProductLimit);
// SECURITY FIX: getAllProducts is now super_admin only — was previously public (exposed all tenant products)
router.get('/get-all-product', authMiddleware('super_admin'), dashboardLimiter, ProductController.getAllProducts);
router.get('/my-products', authMiddleware('tenant_admin'), dashboardLimiter, ProductController.getMyProducts);
router.get('/get-product-by-tenant/:tenantId', storefrontPublicLimiter, ProductController.getProductsByTenant);
router.get('/get-product/:id', storefrontPublicLimiter, ProductController.getSingleProduct);
router.patch('/update-product/:id', authMiddleware('tenant_admin'), uploadLimiter, upload.array('images', 4), validateRequest(ProductValidation.updateProductValidation), ProductController.updateProduct);
router.delete('/delete-product/:id', authMiddleware('tenant_admin'), dashboardLimiter, ProductController.deleteProduct);
router.delete('/tenant/:tenantId/all', authMiddleware('super_admin'), dashboardLimiter, ProductController.deleteAllProductsByTenant);

export const ProductRoutes = router;
