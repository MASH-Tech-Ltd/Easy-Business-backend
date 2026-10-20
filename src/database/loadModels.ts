/**
 * Explicitly imports all domain models so that mongoose.connection.models
 * has all registered models available for backup and replication.
 */
import '../modules/tenant/tenant.model';
import '../modules/auth/auth.model';
import '../modules/product/product.model';
import '../modules/category/category.model';
import '../modules/order/order.model';
import '../modules/package/package.model';
import '../modules/addon/addon.model';
import '../modules/subscription/subscription.model';
import '../modules/billing/billing.model';
import '../modules/customer/customer.model';
import '../modules/courier/courier.model';
import '../modules/courierSync/courierSync.model';
import '../modules/theme/theme.model';
import '../modules/support/support.model';
import '../modules/notification/notification.model';
import '../modules/referral/referral.model';
import '../modules/checkoutLead/checkoutLead.model';
import '../modules/contactInquiry/contactInquiry.model';
import '../modules/fraudCheck/fraudCheck.model';
import '../modules/analytics/storeVisit.model';
import '../modules/analytics/tracking.model';
import '../modules/system/globalSetting.model';
import '../modules/system/security.model';
import './backupLog.model';

export const ensureAllModelsLoaded = () => {
  // All models are imported above
};
