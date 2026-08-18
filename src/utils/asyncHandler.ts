import type { Request, Response, NextFunction } from "express";
import fs from "fs";

type AsyncController = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

const removeLocalFile = (file?: any): void => {
  if (file?.path && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
};

const cleanupUploadedFiles = (req: Request | any): void => {
  removeLocalFile(req.file);

  if (Array.isArray(req.files)) {
    req.files.forEach(removeLocalFile);
    return;
  }

  if (req.files && typeof req.files === "object") {
    Object.values(req.files).flat().forEach(removeLocalFile);
  }
};

export const asyncHandler = (fn: AsyncController) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      cleanupUploadedFiles(req);

      next(error);
    }
  };
};
