import type { Response } from "express";

class ApiResponse<T = unknown> {
  message: string;
  statusCode: number;
  status: string;
  meta?: any;
  data: T | null;

  constructor(
    message: string,
    statusCode: number,
    data?: T | null,
    meta?: any,
  ) {
    this.message = message;
    this.statusCode = statusCode;
    this.status = statusCode >= 200 && statusCode < 300 ? "ok" : "error";
    this.meta = meta;
    this.data = data ?? null;
  }

  static sendSuccess<T>(
    res: Response,
    statusCode: number,
    message: string,
    data?: T,
    meta?: any,
  ) {
    return res
      .status(statusCode)
      .json(new ApiResponse<T>(message, statusCode, data, meta));
  }

  static sendError(
    res: Response,
    statusCode: number,
    message: string,
    errors?: any,
  ) {
    return res
      .status(statusCode)
      .json(
        new ApiResponse(
          message,
          statusCode,
          null,
          errors ? { errors } : undefined,
        ),
      );
  }
}

export default ApiResponse;
