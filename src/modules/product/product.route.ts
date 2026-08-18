import { Router } from 'express';
import { ProductController } from './product.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { upload } from '../../middleware/multer.middleware';

const router = Router();

router.post('/create-product', authMiddleware('tenant_admin'), upload.array('images', 5), ProductController.createProduct);
router.get('/check-limit', authMiddleware('tenant_admin'), ProductController.checkProductLimit);
router.get('/get-all-product', ProductController.getAllProducts);
router.get('/my-products', authMiddleware('tenant_admin'), ProductController.getMyProducts);
router.get('/get-product-by-tenant/:tenantId', ProductController.getProductsByTenant);
router.get('/get-product/:id', ProductController.getSingleProduct);
router.patch('/update-product/:id', authMiddleware('tenant_admin'), upload.array('images', 5), ProductController.updateProduct);
router.delete('/delete-product/:id', authMiddleware('tenant_admin'), ProductController.deleteProduct);

export const ProductRoutes = router;
