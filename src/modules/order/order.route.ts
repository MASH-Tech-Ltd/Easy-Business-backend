import { Router } from 'express';
import { OrderController } from './order.controller';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Storefront creates order (public)
router.post('/create-order', OrderController.createOrder);

// Dashboard gets orders (protected)
router.get('/my-orders', authMiddleware('tenant_admin'), OrderController.getMyOrders);

// Dashboard updates order (protected)
router.patch('/update-order/:id', authMiddleware('tenant_admin'), OrderController.updateOrder);

// Dashboard deletes order (protected)
router.delete('/delete-order/:id', authMiddleware('tenant_admin'), OrderController.deleteOrder);

export const OrderRoutes = router;
