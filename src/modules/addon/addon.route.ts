import { Router } from 'express';
import { AddonController } from './addon.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Only super admin can manage addons globally
router.post('/', authMiddleware('super_admin'), AddonController.createAddon);
router.put('/:id', authMiddleware('super_admin'), AddonController.updateAddon);
router.delete('/:id', authMiddleware('super_admin'), AddonController.deleteAddon);

// Tenant admins can view available addons
router.get('/predefined', authMiddleware('super_admin', 'tenant_admin'), AddonController.getPredefinedAddons);
router.get('/', authMiddleware('super_admin', 'tenant_admin'), AddonController.getAllAddons);
router.get('/:id', authMiddleware('super_admin', 'tenant_admin'), AddonController.getAddonById);

export const AddonRoutes = router;
