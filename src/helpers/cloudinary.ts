import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import CustomError from './CustomError';
import config from '../config';

cloudinary.config({
  cloud_name: config.cloudinary.cloudName as string,
  api_key: config.cloudinary.apiKey as string,
  api_secret: config.cloudinary.apiSecret as string,
});

interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  resource_type: string;
}

export type CloudinaryResourceType = 'image' | 'video' | 'raw' | 'auto';

const CLOUDINARY_PROJECT_FOLDER = 'electronics';

const getCloudinaryFolder = (resourceType: CloudinaryResourceType): string => {
  if (resourceType === 'video') return `${CLOUDINARY_PROJECT_FOLDER}/video`;
  if (resourceType === 'raw') return `${CLOUDINARY_PROJECT_FOLDER}/raw`;
  if (resourceType === 'auto') return `${CLOUDINARY_PROJECT_FOLDER}/media`;
  return `${CLOUDINARY_PROJECT_FOLDER}/image`;
};

const getPublicId = (cloudinaryPublicId: string): string =>
  cloudinaryPublicId.split('/').pop() ?? cloudinaryPublicId;

const getDestroyPublicId = (
  publicId: string,
  resourceType: CloudinaryResourceType,
): string => {
  if (publicId.includes('/')) return publicId;
  return `${getCloudinaryFolder(resourceType)}/${publicId}`;
};

export const uploadCloudinary = async (
  filePath: string,
): Promise<CloudinaryUploadResult> => {
  try {
    if (!filePath || !fs.existsSync(filePath as string)) {
      throw new CustomError(400, 'Image path missing');
    }

    const cloudinaryResponse = await cloudinary.uploader.upload(filePath, {
      resource_type: 'image',
      folder: getCloudinaryFolder('image'),
      quality: 'auto:good',
      fetch_format: 'auto',
      width: 1280,
      crop: 'limit',
    });

    fs.unlinkSync(filePath);

    return {
      public_id: getPublicId(cloudinaryResponse.public_id),
      secure_url: cloudinaryResponse.secure_url,
      resource_type: cloudinaryResponse.resource_type,
    };
  } catch (error: any) {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    throw new CustomError(
      500,
      `Failed to upload image: ${error?.message ?? 'Unknown error'}`,
    );
  }
};

export const uploadMediaCloudinary = async (
  filePath: string,
  resourceType: CloudinaryResourceType = 'auto',
): Promise<CloudinaryUploadResult> => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new CustomError(400, 'File path missing');
    }

    const uploadOptions: any = {
      resource_type: resourceType,
      folder: getCloudinaryFolder(resourceType),
    };

    if (resourceType === 'image' || resourceType === 'auto') {
      uploadOptions.quality = 'auto:good';
      uploadOptions.fetch_format = 'auto';
      uploadOptions.width = 1280,
      uploadOptions.crop = 'limit';
    }

    const cloudinaryResponse = await cloudinary.uploader.upload(filePath, uploadOptions);

    fs.unlinkSync(filePath);

    return {
      public_id: getPublicId(cloudinaryResponse.public_id),
      secure_url: cloudinaryResponse.secure_url,
      resource_type: cloudinaryResponse.resource_type,
    };
  } catch (error: any) {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    throw new CustomError(
      500,
      `Failed to upload file: ${error?.message ?? 'Unknown error'}`,
    );
  }
};

export const deleteCloudinary = async (
  publicId: string,
  resourceType: CloudinaryResourceType = 'image',
): Promise<unknown> => {
  try {
    return await cloudinary.uploader.destroy(getDestroyPublicId(publicId, resourceType), {
      resource_type: resourceType,
    });
  } catch (error: any) {
    throw new CustomError(
      500,
      `Failed to delete file from Cloudinary: ${
        error?.message ?? 'Unknown error'
      }`,
    );
  }
};

export const deleteMultipleCloudinary = async (
  publicIds: string[],
  resourceType: CloudinaryResourceType = 'image',
): Promise<void> => {
  if (!publicIds || publicIds.length === 0) return;

  const validIds = publicIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
  if (validIds.length === 0) return;

  const formattedIds = validIds.map((pid) => getDestroyPublicId(pid.trim(), resourceType));

  const chunkSize = 100;
  for (let i = 0; i < formattedIds.length; i += chunkSize) {
    const chunk = formattedIds.slice(i, i + chunkSize);
    try {
      await cloudinary.api.delete_resources(chunk, { resource_type: resourceType });
    } catch (err: any) {
      // Fallback: individual destroy
      await Promise.allSettled(
        chunk.map((id) =>
          cloudinary.uploader.destroy(id, { resource_type: resourceType }).catch((e) => console.error(`Failed to destroy Cloudinary image ${id}:`, e))
        )
      );
    }
  }
};

export const extractPublicIdFromUrl = (url: string): string | null => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return null;
  try {
    const parts = url.split('/upload/');
    if (parts.length < 2 || !parts[1]) return null;
    let path: string = parts[1];
    path = path.replace(/^v\d+\//, '');
    const dotIdx = path.lastIndexOf('.');
    if (dotIdx !== -1) {
      path = path.substring(0, dotIdx);
    }
    return path || null;
  } catch (e) {
    return null;
  }
};

export const deleteCloudinaryFromUrl = async (
  url: string,
  resourceType: CloudinaryResourceType = 'image',
): Promise<unknown> => {
  const publicId = extractPublicIdFromUrl(url);
  if (publicId) {
    return deleteCloudinary(publicId, resourceType);
  }
  return null;
};
