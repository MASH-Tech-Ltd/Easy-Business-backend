import { Router } from 'express';
import { ThemeController } from './theme.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { upload } from '../../middleware/multer.middleware';

const router = Router();

router.put('/update', authMiddleware('tenant_admin'), upload.single('bannerImage'), ThemeController.updateTheme);
router.get('/my-theme', authMiddleware('tenant_admin'), ThemeController.getMyTheme);

export const ThemeRoutes = router;
