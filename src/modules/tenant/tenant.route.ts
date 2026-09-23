import { Router } from 'express';
import { TenantController } from './tenant.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { upload } from '../../middleware/multer.middleware';
import { validateRequest } from '../../middleware/validateRequest';
import { createTenantValidation, updateStoreValidation } from './tenant.validation';

const router = Router();


// Public routes
router.get('/info', TenantController.getStoreInfoByDomain);

// Protected dashboard routes
router.get('/my-store', authMiddleware('tenant_admin'), TenantController.getMyStore);
router.patch('/update-store', authMiddleware('tenant_admin'), upload.single('logo'), TenantController.updateMyStore);
router.post('/custom-domain', authMiddleware('tenant_admin'), TenantController.addCustomDomain);

// Super Admin routes
router.post('/create-tenant', authMiddleware('super_admin'), validateRequest(createTenantValidation), TenantController.createTenant);
router.get('/get-all-tenants', authMiddleware('super_admin'), TenantController.getAllTenants);
router.get('/:id/metrics', authMiddleware('super_admin'), TenantController.getTenantMetrics);
router.patch('/update-tenant/:id', authMiddleware('super_admin'), TenantController.updateTenant);
router.delete('/delete-tenant/:id', authMiddleware('super_admin'), TenantController.deleteTenant);

export const TenantRoutes = router;
