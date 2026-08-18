import type { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import fs from "fs";
import CustomError from "./CustomError";

const developmentError = (error: CustomError, res: Response): Response => {
  const fullStack = error.stack ? error.stack.split("\n") : [];
  const firstLine = fullStack[0];
  const header = firstLine ? [firstLine.trim()] : [];
  const remaining = fullStack.slice(1);

  const origins = remaining
    .filter((line) => (line.includes("src/") || line.includes("src\\")) && !line.includes("node_modules"))
    .map((line) => line.trim());

  const others = remaining
    .filter((line) => !((line.includes("src/") || line.includes("src\\")) && !line.includes("node_modules")))
    .map((line) => line.trim());

  const sequentialStack = [...header, ...origins, ...others];

  const errorResponse: any = {
    message: error.message,
    success: false,
    status: error.status,
    statusCode: error.statusCode,
    isOperationalError: error.isOperationalError,
  };

  if (error.data) {
    errorResponse.data = error.data;
  }

  errorResponse.stack = sequentialStack;

  return res.status(error.statusCode).json(errorResponse);
};

const productionError = (error: CustomError, res: Response): Response => {
  return res.status(error.statusCode).json({
    message: error.message,
    success: false,
    status: error.status,
    statusCode: error.statusCode,
    ...(error.data ? { data: error.data } : {}),
  });
};

export const globalErrorHandler = (
  error: Error,
  req: Request | any,
  res: Response,
  next: NextFunction
): Response | void => {
  console.error("Global Error Handler caught an error:", error);
  console.error("Request Body:", req.body);
  
  if (req.file && req.file.path && fs.existsSync(req.file.path)) {
    try { fs.unlinkSync(req.file.path); } catch (e) { console.error("Failed to delete temp file:", e); }
  }

  if (req.files) {
    const files = req.files as any[] | { [fieldname: string]: any[] };
    if (Array.isArray(files)) {
      files.forEach((file) => {
        if (file.path && fs.existsSync(file.path)) {
           try { fs.unlinkSync(file.path); } catch (e) {}
        }
      });
    } else {
      Object.values(files).forEach((fileArray) => {
        fileArray.forEach((file) => {
          if (file.path && fs.existsSync(file.path)) {
             try { fs.unlinkSync(file.path); } catch (e) {}
          }
        });
      });
    }
  }

  let err: CustomError = error instanceof CustomError
    ? error
    : new CustomError(500, error.message);

  if (error instanceof jwt.TokenExpiredError) {
    err = new CustomError(401, "JWT token expired.");
  } else if (error instanceof jwt.JsonWebTokenError) {
    err = new CustomError(401, "Invalid access token.");
  } else
    if (error.name === "ValidationError") {
      const validationErrors = Object.values((error as mongoose.Error.ValidationError).errors).map((el: any) => ({
        field: el.path,
        message: el.message,
        kind: el.kind,
      }));
      err = new CustomError(400, "Validation failed", validationErrors);
    } else if ((error as any).code === 11000) {
      const key = Object.keys((error as any).keyValue)[0];
      const value = (error as any).keyValue[key as string];
      let message = `Duplicate field value: ${value}`;

      if (key === "phone") {
        message = "Number already use , try with another";
      } else if (key === "email") {
        message = "Email already use , try with another";
      }

      err = new CustomError(400, message, { field: key, value });
    } else if (error.name === "CastError") {
      const castError = error as mongoose.Error.CastError;
      err = new CustomError(400, `Invalid ${castError.path}: ${castError.value}`, { field: castError.path, value: castError.value });
    }

  if (process.env.NODE_ENV === "development") {
    return developmentError(err, res);
  }
  return productionError(err, res);
};
