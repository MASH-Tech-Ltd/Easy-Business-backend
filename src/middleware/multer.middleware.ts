import multer, { StorageEngine, MulterError, FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import CustomError from '../helpers/CustomError';
import { Request } from 'express';
import os from 'os';

const uploadDir = path.join(process.cwd(), 'public/temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage: StorageEngine = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB limit
  },
  fileFilter: (
    req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback,
  ) => {
    if (
      file.mimetype === 'image/jpeg' ||
      file.mimetype === 'image/png' ||
      file.mimetype === 'image/jpg' ||
      file.mimetype === 'image/webp'
    ) {
      cb(null, true);
    } else {
      cb(
        new CustomError(
          400,
          'Unsupported file type! Only JPEG, PNG, JPG and WEBP are allowed.',
        ) as any,
        false,
      );
    }
  },
});
