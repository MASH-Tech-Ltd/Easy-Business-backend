import { Router } from 'express';
import { PackageController } from './package.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// In the future, protect these with authMiddleware('super_admin')
router.post('/create-package', PackageController.createPackage);
router.get('/get-all-packages', PackageController.getAllPackages);
router.patch('/update-package/:id', PackageController.updatePackage);

export const PackageRoutes = router;
