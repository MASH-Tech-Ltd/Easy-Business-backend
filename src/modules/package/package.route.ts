import { Router } from 'express';
import { PackageController } from './package.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { createPackageValidation, updatePackageValidation } from './package.validation';

const router = Router();

// Public — no auth required. Used by the landing page pricing section.
router.get('/public-packages', PackageController.getPublicPackages);

// Protected admin routes
router.post('/create-package', authMiddleware('super_admin'), validateRequest(createPackageValidation), PackageController.createPackage);
router.get('/get-all-packages', authMiddleware('super_admin', 'tenant_admin'), PackageController.getAllPackages);
router.patch('/update-package/:id', authMiddleware('super_admin'), validateRequest(updatePackageValidation), PackageController.updatePackage);
router.delete('/delete-package/:id', authMiddleware('super_admin'), PackageController.deletePackage);

export const PackageRoutes = router;
