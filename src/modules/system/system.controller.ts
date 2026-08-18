import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const getHealthStats = asyncHandler(async (req: Request, res: Response) => {
  // Simulated OS level stats
  const data = {
    uptime: '99.99%',
    cpu: '18%',
    memory: '3.2 GB',
    latency: '45ms'
  };
  ApiResponse.sendSuccess(res, 200, 'Health stats retrieved', data);
});

const getLogs = asyncHandler(async (req: Request, res: Response) => {
  // Simulated Server logs
  const data = [
    { timestamp: new Date().toISOString(), level: 'INFO', message: 'System initialized successfully.' },
    { timestamp: new Date(Date.now() - 5000).toISOString(), level: 'WARN', message: 'High memory usage detected.' },
    { timestamp: new Date(Date.now() - 15000).toISOString(), level: 'INFO', message: 'New tenant onboarded: Test Store' },
  ];
  ApiResponse.sendSuccess(res, 200, 'Logs retrieved', data);
});

const getDatabaseStats = asyncHandler(async (req: Request, res: Response) => {
  // Simulated MongoDB stats
  const data = {
    status: 'Connected',
    storage: '1.2 GB',
    connections: '42'
  };
  ApiResponse.sendSuccess(res, 200, 'Database stats retrieved', data);
});

const getSecurityStats = asyncHandler(async (req: Request, res: Response) => {
  // Simulated Security stats
  const data = {
    status: 'Secure',
    alerts: '0',
    failedLogins: '3'
  };
  ApiResponse.sendSuccess(res, 200, 'Security stats retrieved', data);
});

export const SystemController = {
  getHealthStats,
  getLogs,
  getDatabaseStats,
  getSecurityStats
};
