import { Router } from 'express';
import { ThemeController } from './theme.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

router.put('/update', authMiddleware('tenant_admin'), ThemeController.updateTheme);
router.get('/my-theme', authMiddleware('tenant_admin'), ThemeController.getMyTheme);

export const ThemeRoutes = router;
