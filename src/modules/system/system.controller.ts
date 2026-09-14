import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import os from 'os';
import mongoose from 'mongoose';
import v8 from 'v8';

const getHealthStats = asyncHandler(async (req: Request, res: Response) => {
  const osUptime = os.uptime();
  const osDays = Math.floor(osUptime / (3600*24));
  const osHours = Math.floor((osUptime % (3600*24)) / 3600);
  const osMinutes = Math.floor((osUptime % 3600) / 60);
  
  const processUptimeRaw = process.uptime();
  const procDays = Math.floor(processUptimeRaw / (3600*24));
  const procHours = Math.floor((processUptimeRaw % (3600*24)) / 3600);
  const procMinutes = Math.floor((processUptimeRaw % 3600) / 60);
  
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsage = `${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`;
  const memoryPercent = Math.round((usedMem / totalMem) * 100);
  
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Unknown';
  const cpuCores = cpus.length;

  const loadAvg = os.loadavg();
  
  const heap = process.memoryUsage();
  
  const nets = os.networkInterfaces();
  let ipAddress = 'Unknown';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ipAddress = net.address;
        break;
      }
    }
    if (ipAddress !== 'Unknown') break;
  }

  const data = {
    osUptime: `${osDays}d ${osHours}h ${osMinutes}m`,
    processUptime: `${procDays}d ${procHours}h ${procMinutes}m`,
    cpu: cpuModel,
    cpuCores: cpuCores,
    memory: memoryUsage,
    memoryPercent: memoryPercent,
    latency: 'Real-time',
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    loadAvg: os.platform() === 'win32' ? 'N/A' : `${(loadAvg[0] ?? 0).toFixed(2)}, ${(loadAvg[1] ?? 0).toFixed(2)}, ${(loadAvg[2] ?? 0).toFixed(2)}`,
    hostname: os.hostname(),
    heapUsed: `${(heap.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    processRss: `${(heap.rss / 1024 / 1024).toFixed(2)} MB`,
    v8HeapLimit: `${(v8.getHeapStatistics().heap_size_limit / 1024 / 1024).toFixed(2)} MB`,
    processPid: process.pid,
    ipAddress: ipAddress,
    externalMem: `${(heap.external / 1024 / 1024).toFixed(2)} MB`,
    arrayBuffers: `${(heap.arrayBuffers / 1024 / 1024).toFixed(2)} MB`,
    env: process.env.NODE_ENV || 'development'
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
  const db = mongoose.connection.db;
  let stats: any = {};
  if (db) {
    stats = await db.command({ dbStats: 1 });
  }
  
  const data = {
    status: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    storage: stats.dataSize ? `${(stats.dataSize / 1024 / 1024).toFixed(2)} MB` : 'Unknown',
    connections: mongoose.connection.readyState === 1 ? 'Active' : '0'
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
