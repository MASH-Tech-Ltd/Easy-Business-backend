import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { deleteMultipleCloudinary } from "../helpers/cloudinary";

type AsyncController = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

export const safelyRemoveFile = (fileOrPath?: any): void => {
  if (!fileOrPath) return;
  const filePath = typeof fileOrPath === "string" ? fileOrPath : fileOrPath?.path;
  if (!filePath || typeof filePath !== "string") return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    // Windows file-lock fallback: retry after a short delay
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlink(filePath, () => {});
        }
      } catch (_) {}
    }, 150);
  }
};

export const cleanupUploadedFiles = async (req: Request | any): Promise<void> => {
  if (!req) return;

  // 1. Clean local temp files (req.file)
  if (req.file) {
    safelyRemoveFile(req.file);
  }

  // 2. Clean local temp files (req.files - array or dictionary)
  if (req.files) {
    if (Array.isArray(req.files)) {
      req.files.forEach(safelyRemoveFile);
    } else if (typeof req.files === "object") {
      Object.values(req.files).forEach((item: any) => {
        if (Array.isArray(item)) {
          item.forEach(safelyRemoveFile);
        } else {
          safelyRemoveFile(item);
        }
      });
    }
  }

  // 3. Clean up Cloudinary images if upload happened before creation/update failed
  try {
    const publicIdsToDelete: string[] = [];

    // Check req.body.images
    if (Array.isArray(req.body?.images)) {
      req.body.images.forEach((img: any) => {
        const pid = typeof img === "string" ? img : img?.public_id;
        if (pid && typeof pid === "string") publicIdsToDelete.push(pid);
      });
    }

    // Check req.body.image
    if (req.body?.image) {
      const pid = typeof req.body.image === "string" ? req.body.image : req.body.image?.public_id;
      if (pid && typeof pid === "string") publicIdsToDelete.push(pid);
    }

    // Check custom tracked uploaded Cloudinary list on req
    if (Array.isArray(req.uploadedCloudinary)) {
      req.uploadedCloudinary.forEach((pid: any) => {
        if (pid && typeof pid === "string") publicIdsToDelete.push(pid);
      });
    }

    if (publicIdsToDelete.length > 0) {
      await deleteMultipleCloudinary(publicIdsToDelete).catch(() => {});
    }
  } catch (_) {}

  // 4. Sweep orphan files older than 5 minutes from public/temp
  try {
    const tempDir = path.join(process.cwd(), "public/temp");
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      const now = Date.now();
      for (const file of files) {
        if (file === ".gitkeep" || file.endsWith(".gitkeep")) continue;
        const fullPath = path.join(tempDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile() && now - stat.mtimeMs > 5 * 60 * 1000) {
            safelyRemoveFile(fullPath);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
};

export const asyncHandler = (fn: AsyncController) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    let cleaned = false;
    const triggerCleanup = () => {
      if (!cleaned) {
        cleaned = true;
        cleanupUploadedFiles(req).catch(() => {});
      }
    };

    // If response was sent with status >= 400 (even without throwing an exception)
    res.on("finish", () => {
      if (res.statusCode >= 400) {
        triggerCleanup();
      }
    });

    // If client aborted / disconnected before response ended
    res.on("close", () => {
      if (!res.writableEnded) {
        triggerCleanup();
      }
    });

    try {
      await fn(req, res, next);
    } catch (error) {
      triggerCleanup();
      next(error);
    }
  };
};
