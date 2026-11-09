import { Router } from 'express';
import { OrderController } from './order.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { checkoutLimiter, dashboardLimiter, manualOrderLimiter } from '../../middleware/rateLimiter';
import { validateRequest } from '../../middleware/validateRequest';
import { OrderValidation } from './order.validation';

const router = Router();

// Storefront creates order (public) — protected by checkout rate limiter and Zod validation
router.post('/create-order', checkoutLimiter, validateRequest(OrderValidation.createOrderValidation), OrderController.createOrder);

// Merchant creates manual order (protected) — scoped strictly to merchant's own store (300 req / 15 min)
router.post('/manual-order', authMiddleware('tenant_admin'), manualOrderLimiter, validateRequest(OrderValidation.createManualOrderValidation), OrderController.createManualOrder);

// Storefront tracks order (public) — light rate limit via global
router.get('/track/:id', OrderController.trackOrder);

// Dashboard gets orders (protected)
router.get('/my-orders', authMiddleware('tenant_admin'), dashboardLimiter, OrderController.getMyOrders);

// Dashboard updates order (protected)
router.patch('/update-order/:id', authMiddleware('tenant_admin'), dashboardLimiter, validateRequest(OrderValidation.updateOrderValidation), OrderController.updateOrder);

// Dashboard deletes order (protected)
router.delete('/delete-order/:id', authMiddleware('tenant_admin'), dashboardLimiter, OrderController.deleteOrder);

export const OrderRoutes = router;
