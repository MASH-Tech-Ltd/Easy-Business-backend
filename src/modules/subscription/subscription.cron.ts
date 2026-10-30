import cron from 'node-cron';
import { Subscription } from './subscription.model';
import { Tenant } from '../tenant/tenant.model';
import { User } from '../auth/auth.model';
import { sendEmail } from '../../utils/sendEmail';
import { subscriptionExpiryReminderTemplate } from '../../templates/subscriptionExpiryReminder';
import { notificationService } from '../notification/notification.service';
import config from '../../config';

export interface ExpiryCheckSummary {
  checked: number;
  warningsSent: number;
  skipped: number;
  errors: number;
  details: Array<{
    tenantId: string;
    storeName: string;
    email: string;
    isTrial: boolean;
    planName: string;
    endDate: Date;
    daysRemaining: number;
    status: 'sent' | 'skipped' | 'error';
    error?: string;
  }>;
}

/**
 * Checks all active subscriptions (both Free Trial and Paid Packages)
 * whose endDate is within the next 48 hours (2 days remaining).
 * Sends a Bengali email reminder and in-app notification to the merchant,
 * then marks `expiryWarningSent = true` to prevent duplicate emails.
 */
export const checkAndSendExpiryWarnings = async (): Promise<ExpiryCheckSummary> => {
  const now = new Date();
  // 48 hours window (with 1 hour buffer: 49 hours)
  const windowEnd = new Date(now.getTime() + 49 * 60 * 60 * 1000);

  const summary: ExpiryCheckSummary = {
    checked: 0,
    warningsSent: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  try {
    // Find active subscriptions (Trial or Paid) expiring within next 48 hours
    const expiringSubscriptions = await Subscription.find({
      status: 'active',
      endDate: { $gt: now, $lte: windowEnd },
      expiryWarningSent: { $ne: true },
    })
      .populate('packageId')
      .populate('tenantId');

    summary.checked = expiringSubscriptions.length;

    console.log(`\n======================================================`);
    console.log(`[SubscriptionCron] Checking expiry warnings at ${now.toISOString()}`);
    console.log(`[SubscriptionCron] Found ${summary.checked} active subscriptions expiring within 48h`);
    console.log(`======================================================`);

    for (const sub of expiringSubscriptions) {
      const tenant = sub.tenantId as any;
      if (!tenant) {
        summary.skipped++;
        continue;
      }

      // Find store owner
      let ownerUser: any = null;
      if (tenant.ownerId) {
        ownerUser = await User.findById(tenant.ownerId);
      }

      const recipientEmail = ownerUser?.email || tenant.contactEmail;
      if (!recipientEmail) {
        console.warn(`[SubscriptionCron] ⚠️ No email found for tenant ${tenant._id} (${tenant.name})`);
        summary.skipped++;
        summary.details.push({
          tenantId: tenant._id?.toString(),
          storeName: tenant.name || 'Unknown Store',
          email: '',
          isTrial: Boolean(sub.isTrial),
          planName: sub.isTrial ? 'ফ্রি ট্রায়াল' : (sub.packageId as any)?.name || 'পেইড প্ল্যান',
          endDate: sub.endDate,
          daysRemaining: 2,
          status: 'skipped',
          error: 'No email address on file',
        });
        continue;
      }

      const storeName = tenant.name || 'আপনার অনলাইন স্টোর';
      const ownerName = ownerUser?.name || tenant.name || 'সম্মানিত মার্চেন্ট';
      const isTrial = Boolean(sub.isTrial);
      const planName = isTrial ? 'ফ্রি ট্রায়াল' : (sub.packageId as any)?.name || 'পেইড প্ল্যান';

      // Calculate days remaining (1 or 2)
      const diffMs = new Date(sub.endDate).getTime() - now.getTime();
      const daysRemaining = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

      const renewalUrl = `${config.app.frontendUrl || 'https://merchant.masheco.com'}/dashboard/subscription`;

      const subject = isTrial
        ? `⚠️ আপনার MASH ECO ফ্রি ট্রায়ালের মেয়াদ আর মাত্র ${daysRemaining === 1 ? '১ দিন' : '২ দিন'} বাকি!`
        : `⚠️ আপনার MASH ECO সাবস্ক্রিপশনের মেয়াদ আর মাত্র ${daysRemaining === 1 ? '১ দিন' : '২ দিন'} বাকি!`;

      const html = subscriptionExpiryReminderTemplate({
        storeName,
        ownerName,
        planName,
        isTrial,
        expiryDate: sub.endDate,
        daysRemaining,
        renewalUrl,
      });

      try {
        // 1. Send Bengali Email
        await sendEmail(recipientEmail, subject, html);

        // 2. Create In-App Notification
        if (tenant.ownerId) {
          try {
            await notificationService.createNotification(
              tenant.ownerId,
              'SUBSCRIPTION_EXPIRING_SOON',
              isTrial ? 'ফ্রি ট্রায়াল শেষের সতর্কতা' : 'সাবস্ক্রিপশনের মেয়াদ শেষের সতর্কতা',
              `আপনার "${storeName}" স্টোরের ${isTrial ? 'ফ্রি ট্রায়ালের' : 'সাবস্ক্রিপশনের'} মেয়াদ আর মাত্র ${daysRemaining} দিন বাকি আছে। মেয়াদ শেষ হওয়ার আগেই রিনিউ সম্পন্ন করুন।`,
              sub._id,
              tenant._id
            );
          } catch (notifErr) {
            console.error('[SubscriptionCron] Failed to send in-app notification:', notifErr);
          }
        }

        // 3. Mark Subscription as Warning Sent
        sub.expiryWarningSent = true;
        sub.expiryWarningSentAt = new Date();
        await sub.save();

        summary.warningsSent++;
        console.log(
          `[SubscriptionCron] ✓ Email sent to ${recipientEmail} for store "${storeName}" (${isTrial ? 'Free Trial' : 'Paid Plan'}). Ends: ${sub.endDate.toISOString()}`
        );

        summary.details.push({
          tenantId: tenant._id?.toString(),
          storeName,
          email: recipientEmail,
          isTrial,
          planName,
          endDate: sub.endDate,
          daysRemaining,
          status: 'sent',
        });
      } catch (sendErr: any) {
        console.error(`[SubscriptionCron] ❌ Failed to send email to ${recipientEmail}:`, sendErr?.message || sendErr);
        summary.errors++;
        summary.details.push({
          tenantId: tenant._id?.toString(),
          storeName,
          email: recipientEmail,
          isTrial,
          planName,
          endDate: sub.endDate,
          daysRemaining,
          status: 'error',
          error: sendErr?.message || 'Email delivery failed',
        });
      }
    }

    console.log(`[SubscriptionCron] Completed: Sent=${summary.warningsSent}, Skipped=${summary.skipped}, Errors=${summary.errors}\n`);
  } catch (error) {
    console.error('[SubscriptionCron] Fatal error checking subscription expiry warnings:', error);
  }

  return summary;
};

/**
 * Initializes the background cron job.
 * Runs every 6 hours (00:00, 06:00, 12:00, 18:00) to ensure merchants
 * are notified exactly 2 days before expiration.
 */
export const initSubscriptionCron = (): void => {
  // Cron schedule: every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      await checkAndSendExpiryWarnings();
    } catch (err) {
      console.error('[SubscriptionCron] Job execution failed:', err);
    }
  });

  console.log('⏰ [SubscriptionCron] Subscription 2-day expiry reminder cron scheduled (runs every 6 hours).');
};

