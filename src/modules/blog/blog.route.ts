import { Router } from 'express';
import { BlogController } from './blog.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { validateRequest } from '../../middleware/validateRequest';
import { upload } from '../../middleware/multer.middleware';
import { createBlogValidation, updateBlogValidation } from './blog.validation';

const router = Router();

// Public routes (No auth required — for merchant landing page)
router.get('/public-blogs', BlogController.getPublicBlogs);
router.get('/public-blogs/:slug', BlogController.getBlogBySlug);
router.post('/seed-blogs', BlogController.seedBlogs);

// Protected admin routes (Requires super_admin)
router.get('/get-all-blogs', authMiddleware('super_admin'), BlogController.getAllBlogs);
router.post('/create-blog', authMiddleware('super_admin'), validateRequest(createBlogValidation), BlogController.createBlog);
router.patch('/update-blog/:id', authMiddleware('super_admin'), validateRequest(updateBlogValidation), BlogController.updateBlog);
router.delete('/delete-blog/:id', authMiddleware('super_admin'), BlogController.deleteBlog);
router.post('/upload-image', authMiddleware('super_admin'), upload.single('image'), BlogController.uploadBlogImage);
router.post('/delete-image', authMiddleware('super_admin'), BlogController.deleteBlogImage);

export const BlogRoutes = router;
