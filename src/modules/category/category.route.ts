import { Router } from 'express';
import { CategoryController } from './category.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { upload } from '../../middleware/multer.middleware';

const router = Router();

router.post('/create-category', authMiddleware('tenant_admin'), upload.single('image'), CategoryController.createCategory);
router.get('/my-categories', authMiddleware('tenant_admin'), CategoryController.getMyCategories);
// SECURITY FIX: getAllCategories now requires super_admin — was public and dumped all tenant categories
router.get('/get-all-category', authMiddleware('super_admin'), CategoryController.getAllCategories);
router.get('/get-category-by-tenant/:tenantId', CategoryController.getCategoriesByTenant);
router.get('/get-category/:id', authMiddleware('tenant_admin'), CategoryController.getSingleCategory);
router.patch('/update-category/:id', authMiddleware('tenant_admin'), upload.single('image'), CategoryController.updateCategory);
router.delete('/delete-category/:id', authMiddleware('tenant_admin'), CategoryController.deleteCategory);

export const CategoryRoutes = router;
