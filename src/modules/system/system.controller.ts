import { Request, Response } from 'express';
import ApiResponse from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import os from 'os';
import mongoose from 'mongoose';
import v8 from 'v8';
import { SecurityLog, BlockedIp, VisitorLog } from './security.model';
import { isCloudflareProxyIp, getClientIp } from '../../utils/ipHelper';

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
    hostname: '********',
    heapUsed: `${(heap.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    processRss: `${(heap.rss / 1024 / 1024).toFixed(2)} MB`,
    v8HeapLimit: `${(v8.getHeapStatistics().heap_size_limit / 1024 / 1024).toFixed(2)} MB`,
    processPid: process.pid,
    ipAddress: '***.***.***.***',
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


const getSecurityLogs = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = (req.query.search as string) || '';
  
  const query: any = {};
  if (search.trim()) {
    query.$or = [
      { ipAddress: { $regex: search.trim(), $options: 'i' } },
      { reason: { $regex: search.trim(), $options: 'i' } },
      { incidentType: { $regex: search.trim(), $options: 'i' } },
      { endpoint: { $regex: search.trim(), $options: 'i' } },
      { requestedFrom: { $regex: search.trim(), $options: 'i' } },
      { user: { $regex: search.trim(), $options: 'i' } },
    ];
  }

  const logs = await SecurityLog.find(query)
    .sort({ date: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
    
  const total = await SecurityLog.countDocuments(query);
  
  ApiResponse.sendSuccess(res, 200, 'Security logs retrieved', { logs, total, page, limit });
});

const getBlockedIps = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = (req.query.search as string) || '';
  
  // Clean up any stale auto-blocked Cloudflare IPs dynamically
  const allBlocked = await BlockedIp.find({ type: 'auto' });
  const cloudflareIpIds = allBlocked.filter(b => isCloudflareProxyIp(b.ipAddress)).map(b => b._id);
  if (cloudflareIpIds.length > 0) {
    await BlockedIp.deleteMany({ _id: { $in: cloudflareIpIds } });
  }

  const query: any = {};
  if (search.trim()) {
    query.$or = [
      { ipAddress: { $regex: search.trim(), $options: 'i' } },
      { reason: { $regex: search.trim(), $options: 'i' } },
    ];
  }

  const ips = await BlockedIp.find(query)
    .sort({ blockedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
    
  const total = await BlockedIp.countDocuments(query);
  
  ApiResponse.sendSuccess(res, 200, 'Blocked IPs retrieved', { ips, total, page, limit });
});

const blockIp = asyncHandler(async (req: Request, res: Response) => {
  const { ipAddress, reason } = req.body;
  if (!ipAddress || !reason) {
    return ApiResponse.sendError(res, 400, 'IP Address and reason are required');
  }

  const existing = await BlockedIp.findOne({ ipAddress: ipAddress as string });
  if (existing) {
    return ApiResponse.sendError(res, 400, 'IP is already blocked');
  }

  await BlockedIp.create({ ipAddress, reason, type: 'manual' });
  ApiResponse.sendSuccess(res, 201, 'IP blocked successfully', null);
});

const unblockIp = asyncHandler(async (req: Request, res: Response) => {
  const { ip } = req.params;
  const deleted = await BlockedIp.findOneAndDelete({ ipAddress: ip as string });
  
  if (!deleted) {
    return ApiResponse.sendError(res, 404, 'Blocked IP not found');
  }
  
  ApiResponse.sendSuccess(res, 200, 'IP unblocked successfully', null);
});

const syncIpCache = asyncHandler(async (req: Request, res: Response) => {
  // 1. Purge legacy auto-blocked Cloudflare proxy IPs
  const allBlocked = await BlockedIp.find({ type: 'auto' });
  const cloudflareIpIds = allBlocked.filter(b => isCloudflareProxyIp(b.ipAddress)).map(b => b._id);
  if (cloudflareIpIds.length > 0) {
    await BlockedIp.deleteMany({ _id: { $in: cloudflareIpIds } });
  }

  // 2. Purge legacy Security Logs recorded under Cloudflare proxy node IPs
  const allSecurityLogs = await SecurityLog.find();
  const cloudflareLogIds = allSecurityLogs.filter(l => isCloudflareProxyIp(l.ipAddress)).map(l => l._id);
  if (cloudflareLogIds.length > 0) {
    await SecurityLog.deleteMany({ _id: { $in: cloudflareLogIds } });
  }

  // 3. Purge legacy Visitor Logs recorded under Cloudflare proxy node IPs
  const allVisitorLogs = await VisitorLog.find();
  const cloudflareVisitorLogIds = allVisitorLogs.filter(v => isCloudflareProxyIp(v.ipAddress)).map(v => v._id);
  if (cloudflareVisitorLogIds.length > 0) {
    await VisitorLog.deleteMany({ _id: { $in: cloudflareVisitorLogIds } });
  }

  // 4. Purge invalid SSR/node server visitor logs
  const invalidSsrVisitorLogs = await VisitorLog.deleteMany({
    $or: [
      { storeName: 'backapi.masheco.com' },
      { storeName: 'adminsec.masheco.com' },
      { userAgent: /^node/i },
      { userAgent: 'node' },
      { userAgent: /^axios/i }
    ]
  });

  // 5. Purge logs older than 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const expiredSecurityLogs = await SecurityLog.deleteMany({ date: { $lt: thirtyDaysAgo } });
  const expiredVisitorLogs = await VisitorLog.deleteMany({ accessedAt: { $lt: thirtyDaysAgo } });

  ApiResponse.sendSuccess(
    res,
    200,
    `IP Cache synced. Purged ${cloudflareIpIds.length} proxy IPs, ${invalidSsrVisitorLogs.deletedCount} SSR node visitor logs, and ${expiredSecurityLogs.deletedCount + expiredVisitorLogs.deletedCount} logs older than 30 days.`,
    null
  );
});

const getVisitorLogs = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = (req.query.search as string) || '';

  // Strict filter: Exclude backend infrastructure domains, internal Node SSR calls, and proxy node IPs
  const filterConditions: any[] = [
    { storeName: { $nin: ['backapi.masheco.com', 'adminsec.masheco.com', 'localhost:8000', '127.0.0.1:8000'] } },
    { userAgent: { $not: /^node/i } },
    { userAgent: { $not: /^axios/i } },
    { ipAddress: { $not: /^2a02:/i } },
    { ipAddress: { $not: /^2606:/i } }
  ];

  if (search.trim()) {
    filterConditions.push({
      $or: [
        { ipAddress: { $regex: search.trim(), $options: 'i' } },
        { storeName: { $regex: search.trim(), $options: 'i' } },
        { ownerName: { $regex: search.trim(), $options: 'i' } },
        { role: { $regex: search.trim(), $options: 'i' } },
        { userAgent: { $regex: search.trim(), $options: 'i' } },
      ]
    });
  }

  const query = { $and: filterConditions };

  const logs = await VisitorLog.find(query)
    .sort({ accessedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
    
  const total = await VisitorLog.countDocuments(query);
  
  ApiResponse.sendSuccess(res, 200, 'Visitor logs retrieved', { logs, total, page, limit });
});

const createVisitorLog = asyncHandler(async (req: Request, res: Response) => {
  const { role, storeName, ownerName } = req.body;
  const userAgent = req.headers['user-agent'] || 'Unknown';

  // Do not record visitor logs for Node SSR calls or backend API domains
  if (/^node/i.test(userAgent) || /^axios/i.test(userAgent) || storeName === 'backapi.masheco.com') {
    return ApiResponse.sendSuccess(res, 200, 'Ignored SSR call', null);
  }

  const ipAddress = getClientIp(req);

  const visitorLog = await VisitorLog.create({
    role: role || 'Merchant',
    storeName: storeName && storeName !== 'backapi.masheco.com' ? storeName : 'Web Store',
    ownerName: ownerName || 'Storefront Visitor',
    ipAddress,
    userAgent
  });

  ApiResponse.sendSuccess(res, 201, 'Visitor log recorded', visitorLog);
});

const clearVisitorLogs = asyncHandler(async (req: Request, res: Response) => {
  await VisitorLog.deleteMany({});
  ApiResponse.sendSuccess(res, 200, 'All visitor logs cleared successfully', null);
});

export const SystemController = {
  getHealthStats,
  getLogs,
  getDatabaseStats,
  getSecurityStats,
  getSecurityLogs,
  getBlockedIps,
  blockIp,
  unblockIp,
  syncIpCache,
  getVisitorLogs,
  createVisitorLog,
  clearVisitorLogs
};
