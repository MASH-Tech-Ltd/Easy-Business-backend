import { Request, Response } from 'express';
import { BlogService } from './blog.service';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { uploadCloudinary } from '../../helpers/cloudinary';
import CustomError from '../../helpers/CustomError';

const uploadBlogImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new CustomError(400, 'Image file is required');
  }
  const uploadResult = await uploadCloudinary(req.file.path);
  ApiResponse.sendSuccess(res, 200, 'Image uploaded successfully', {
    url: uploadResult.secure_url,
    public_id: uploadResult.public_id,
  });
});

const createBlog = asyncHandler(async (req: Request, res: Response) => {
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
};
