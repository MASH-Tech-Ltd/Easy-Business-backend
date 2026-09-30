import { Request, Response } from 'express';
import { CourierSyncService } from './courierSync.service';
import { runCourierStatusSync } from '../courier/courier.cron';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * GET /courier-sync/latest
 * Returns the most recent sync report from DB (for dashboard restore on reload).
 */
const getLatest = asyncHandler(async (_req: Request, res: Response) => {
  const report = await CourierSyncService.getLatestReport();
  ApiResponse.sendSuccess(res, 200, 'Latest courier sync report', report);
});

/**
 * GET /courier-sync/history
 * Returns paginated sync reports (without heavy details arrays).
 */
const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '10', 10);
  const reports = await CourierSyncService.getReportHistory(page, limit);
  ApiResponse.sendSuccess(res, 200, 'Courier sync history', reports.data, reports.meta);
});

/**
 * GET /courier-sync/report/:id
 * Returns a specific sync report with full details.
 */
const getById = asyncHandler(async (req: Request, res: Response) => {
  const report = await CourierSyncService.getReportById(req.params.id as string);
  if (!report) return ApiResponse.sendError(res, 404, 'Report not found');
  ApiResponse.sendSuccess(res, 200, 'Courier sync report', report);
});

/**
 * DELETE /courier-sync/report/:id
 * Deletes a specific sync report.
 */
const deleteById = asyncHandler(async (req: Request, res: Response) => {
  await CourierSyncService.deleteReportById(req.params.id as string);
  ApiResponse.sendSuccess(res, 200, 'Report deleted successfully', null);
});

/**
 * POST /courier-sync/run
 * Triggers a manual sync, saves result to DB, and returns it.
 */
const runSync = asyncHandler(async (_req: Request, res: Response) => {
  const result = await runCourierStatusSync();
  const saved  = await CourierSyncService.saveSyncReport(result);
  ApiResponse.sendSuccess(res, 200, 'Courier status sync completed', saved);
});

export const CourierSyncController = {
  getLatest,
  getHistory,
  getById,
  deleteById,
  runSync,
};
