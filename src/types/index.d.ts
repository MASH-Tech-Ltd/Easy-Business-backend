import { JwtPayload } from 'jsonwebtoken';
import type { ClientIpResult } from '../utils/ipHelper';
import type { TrackedUpload } from '../modules/media/media.interface';

declare global {
  namespace Express {
    interface Request {
      user: JwtPayload | any;
      /** Cached result of resolveClientIp() — see utils/ipHelper.ts */
      clientIpInfo?: ClientIpResult;
      /** Server-tracked media uploads made during this request for failure cleanup. */
      uploadedMedia?: TrackedUpload[];
    }
  }
}
