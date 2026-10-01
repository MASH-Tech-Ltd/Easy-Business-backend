import { Router } from 'express';
import { OrderController } from './order.controller';
import { authMiddleware } from '../../middleware/authMiddleware';
import { checkoutLimiter, dashboardLimiter } from '../../middleware/rateLimiter';
import { validateRequest } from '../../middleware/validateRequest';
import { OrderValidation } from './order.validation';

const router = Router();

// Storefront creates order (public) — protected by checkout rate limiter and Zod validation
router.post('/create-order', checkoutLimiter, validateRequest(OrderValidation.createOrderValidation), OrderController.createOrder);

// Storefront tracks order (public) — light rate limit via global
router.get('/track/:id', OrderController.trackOrder);

// Dashboard gets orders (protected)
router.get('/my-orders', authMiddleware('tenant_admin'), dashboardLimiter, OrderController.getMyOrders);

// Dashboard updates order (protected)
router.patch('/update-order/:id', authMiddleware('tenant_admin'), dashboardLimiter, validateRequest(OrderValidation.updateOrderValidation), OrderController.updateOrder);

// Dashboard deletes order (protected)
router.delete('/delete-order/:id', authMiddleware('tenant_admin'), dashboardLimiter, OrderController.deleteOrder);

export const OrderRoutes = router;
