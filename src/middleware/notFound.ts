import { NextFunction, Request, Response } from "express";
import CustomError from "../helpers/CustomError";
export const notFound = (req: Request, res: Response, next: NextFunction) => {
    const errorData = [{ method: req.method, url: req.originalUrl }];
    const error = new CustomError(
        404,
        `!!Route not found`,
    );
    return res.status(error.statusCode).json({
        message: error.message,
        success: false,
        status: error.status,
    });
}
