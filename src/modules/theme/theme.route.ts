import { Router } from 'express';
import { ThemeController } from './theme.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { upload } from '../../middleware/multer.middleware';

const router = Router();

router.put('/update', authMiddleware('tenant_admin'), upload.fields([{ name: 'bannerImages', maxCount: 5 }, { name: 'bannerImage', maxCount: 5 }]), ThemeController.updateTheme);
router.get('/my-theme', authMiddleware('tenant_admin'), ThemeController.getMyTheme);
router.get('/previews', ThemeController.getThemePreviews);

export const ThemeRoutes = router;
