import express from 'express';
import { BlockedPhoneController } from './blockedPhone.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { dashboardLimiter } from '../../middleware/rateLimiter';
import { validateRequest } from '../../middleware/validateRequest';
import {
  blockPhoneValidation,
  getBlockedPhonesValidation,
  unblockPhoneValidation,
} from './blockedPhone.validation';

const router = express.Router();

router.get(
  '/',
  authMiddleware('tenant_admin'),
  dashboardLimiter,
  validateRequest(getBlockedPhonesValidation),
  BlockedPhoneController.getBlockedPhones
);
router.post(
  '/',
  authMiddleware('tenant_admin'),
  dashboardLimiter,
  validateRequest(blockPhoneValidation),
  BlockedPhoneController.blockPhone
);
router.delete(
  '/:phone',
  authMiddleware('tenant_admin'),
  dashboardLimiter,
  validateRequest(unblockPhoneValidation),
  BlockedPhoneController.unblockPhone
);

export const BlockedPhoneRoutes = router;

