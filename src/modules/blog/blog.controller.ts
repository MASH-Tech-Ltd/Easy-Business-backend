import { Request, Response } from 'express';
import { BlogService } from './blog.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { MediaService } from '../media/media.service';
import CustomError from '../../helpers/CustomError';

const deleteBlogImage = asyncHandler(async (req: Request, res: Response) => {
  const { url, public_id } = req.body;
  if (!url && !public_id) {
    throw new CustomError(400, 'Image url or public_id is required');
  }

  await MediaService.deleteImages(
    [url ? url : { public_id }],
    { tenantId: null, reason: 'blog_image_delete' },
  );

  ApiResponse.sendSuccess(res, 200, 'Image deleted successfully');
});

const uploadBlogImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new CustomError(400, 'Image file is required');
  }
  const uploadResult = await MediaService.uploadImage(req, req.file.path, {
    tenantId: null,
    kind: 'blog',
  });
  ApiResponse.sendSuccess(res, 200, 'Image uploaded successfully', {
    url: uploadResult.secure_url,
    public_id: uploadResult.public_id,
    provider: uploadResult.provider,
  });
});

const createBlog = asyncHandler(async (req: Request, res: Response) => {
  if (req.file) {
    const uploadResult = await MediaService.uploadImage(req, req.file.path, {
      tenantId: null,
      kind: 'blog',
    });
    req.body.thumbnail = uploadResult.secure_url;
  }
  if (typeof req.body.isPublished === 'string') {
    req.body.isPublished = req.body.isPublished === 'true';
  }
  if (typeof req.body.featured === 'string') {
    req.body.featured = req.body.featured === 'true';
  }
  if (typeof req.body.tags === 'string') {
    try {
      req.body.tags = JSON.parse(req.body.tags);
    } catch {
      req.body.tags = req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
  }
  const result = await BlogService.createBlog(req.body);
  ApiResponse.sendSuccess(res, 201, 'Blog post created successfully', result);
});

const getAllBlogs = asyncHandler(async (req: Request, res: Response) => {
  const { data, meta } = await BlogService.getAllBlogs({
    page: req.query.page as string,
    limit: req.query.limit as string,
    searchTerm: req.query.searchTerm as string,
    category: req.query.category as string,
    status: req.query.status as any,
  });
  ApiResponse.sendSuccess(res, 200, 'Blogs retrieved successfully', data, meta);
});

const getPublicBlogs = asyncHandler(async (req: Request, res: Response) => {
  const { data, meta } = await BlogService.getPublicBlogs({
    page: req.query.page as string,
    limit: req.query.limit as string,
    searchTerm: req.query.search as string || req.query.searchTerm as string,
    category: req.query.category as string,
  });
  ApiResponse.sendSuccess(res, 200, 'Public blogs retrieved successfully', data, meta);
});

const getBlogBySlug = asyncHandler(async (req: Request, res: Response) => {
  const result = await BlogService.getBlogBySlug(req.params.slug as string);
  ApiResponse.sendSuccess(res, 200, 'Article retrieved successfully', result);
});

const updateBlog = asyncHandler(async (req: Request, res: Response) => {
  if (req.file) {
    const uploadResult = await MediaService.uploadImage(req, req.file.path, {
      tenantId: null,
      kind: 'blog',
    });
    req.body.thumbnail = uploadResult.secure_url;
  }
  if (typeof req.body.isPublished === 'string') {
    req.body.isPublished = req.body.isPublished === 'true';
  }
  if (typeof req.body.featured === 'string') {
    req.body.featured = req.body.featured === 'true';
  }
  if (typeof req.body.tags === 'string') {
    try {
      req.body.tags = JSON.parse(req.body.tags);
    } catch {
      req.body.tags = req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
  }
  const result = await BlogService.updateBlog(req.params.id as string, req.body);
  ApiResponse.sendSuccess(res, 200, 'Blog post updated successfully', result);
});

const deleteBlog = asyncHandler(async (req: Request, res: Response) => {
  const result = await BlogService.deleteBlog(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Blog post deleted successfully', result);
});

const seedBlogs = asyncHandler(async (req: Request, res: Response) => {
  const force = req.query.force === 'true' || req.body?.force === true;
  await BlogService.seedInitialBlogs(force);
  const { data, meta } = await BlogService.getPublicBlogs({});
  ApiResponse.sendSuccess(res, 200, 'Blogs seeded successfully with default articles', data, meta);
});

export const BlogController = {
  createBlog,
  getAllBlogs,
  getPublicBlogs,
  getBlogBySlug,
  updateBlog,
  deleteBlog,
  seedBlogs,
  uploadBlogImage,
  deleteBlogImage,
};
