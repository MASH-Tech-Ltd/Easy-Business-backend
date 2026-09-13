import { Router } from 'express';
import { AuthRoutes } from '../modules/auth/auth.route';
import { ProductRoutes } from '../modules/product/product.route';
import { TenantRoutes } from '../modules/tenant/tenant.route';
import { CategoryRoutes } from '../modules/category/category.route';
import { PackageRoutes } from '../modules/package/package.route';
import { AddonRoutes } from '../modules/addon/addon.route';
import { SubscriptionRoutes } from '../modules/subscription/subscription.route';
import { OrderRoutes } from '../modules/order/order.route';
import { CourierRoutes } from '../modules/courier/courier.route';
import { CustomerRoutes } from '../modules/customer/customer.route';
import { ThemeRoutes } from '../modules/theme/theme.route';
import { AnalyticsRoutes } from '../modules/analytics/analytics.route';
import { SystemRoutes } from '../modules/system/system.route';
import { BillingRoutes } from '../modules/billing/billing.route';
import { StorefrontRoutes } from '../modules/storefront/storefront.route';
import { FraudCheckRoutes } from '../modules/fraudCheck/fraudCheck.route';

import { UserRoutes } from '../modules/user/user.route';
import { SupportRoutes } from '../modules/support/support.route';
import { NotificationRoutes } from '../modules/notification/notification.route';
import { SeedRoutes } from '../modules/seed/seed.route';
import { CheckoutLeadRoutes } from '../modules/checkoutLead/checkoutLead.route';

const router = Router();

const moduleRoutes = [
  {
    path: '/users',
    route: UserRoutes,
  },
  {
    path: '/tenants',
    route: TenantRoutes,
  },
  {
    path: '/auth',
    route: AuthRoutes,
  },
  {
    path: '/categories',
    route: CategoryRoutes,
  },
  {
    path: '/products',
    route: ProductRoutes,
  },
  {
    path: '/packages',
    route: PackageRoutes,
  },
  {
    path: '/subscriptions',
    route: SubscriptionRoutes,
  },
  {
    path: '/addons',
    route: AddonRoutes,
  },
  {
    path: '/orders',
    route: OrderRoutes,
  },
  {
    path: '/courier',
    route: CourierRoutes,
  },
  {
    path: '/customers',
    route: CustomerRoutes,
  },
  {
    path: '/themes',
    route: ThemeRoutes,
  },
  {
    path: '/analytics',
    route: AnalyticsRoutes,
  },
  {
    path: '/system',
    route: SystemRoutes,
  },
  {
    path: '/billing',
    route: BillingRoutes,
  },
  {
    path: '/storefront',
    route: StorefrontRoutes,
  },
  {
    path: '/fraud',
    route: FraudCheckRoutes,
  },
  {
    path: '/notifications',
    route: NotificationRoutes,
  },
  {
    path: '/support',
    route: SupportRoutes,
  },
  {
    path: '/seed',
    route: SeedRoutes,
  },
  {
    path: '/checkout-leads',
    route: CheckoutLeadRoutes,
  },
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to MashEasy Multitenant API' });
});

export default router;
