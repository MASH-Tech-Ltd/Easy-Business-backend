import { JwtPayload } from 'jsonwebtoken';
import type { ClientIpResult } from '../utils/ipHelper';

declare global {
  namespace Express {
    interface Request {
      user: JwtPayload | any;
      /** Cached result of resolveClientIp() — see utils/ipHelper.ts */
      clientIpInfo?: ClientIpResult;
    }
  }
}
