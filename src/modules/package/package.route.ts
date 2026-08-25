import { Router } from 'express';
import { PackageController } from './package.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { createPackageValidation, updatePackageValidation } from './package.validation';

const router = Router();

// In the future, protect these with authMiddleware('super_admin')
router.post('/create-package', authMiddleware('super_admin'), validateRequest(createPackageValidation), PackageController.createPackage);
router.get('/get-all-packages', authMiddleware('super_admin', 'tenant_admin'), PackageController.getAllPackages);
router.patch('/update-package/:id', authMiddleware('super_admin'), validateRequest(updatePackageValidation), PackageController.updatePackage);
router.delete('/delete-package/:id', authMiddleware('super_admin'), PackageController.deletePackage);

export const PackageRoutes = router;
