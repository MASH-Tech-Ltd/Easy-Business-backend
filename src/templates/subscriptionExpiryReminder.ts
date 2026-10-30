export interface SubscriptionExpiryReminderData {
  storeName: string;
  ownerName?: string;
  planName: string;
  isTrial?: boolean;
  expiryDate: Date | string;
  daysRemaining?: number;
  renewalUrl?: string;
}

export const subscriptionExpiryReminderTemplate = (data: SubscriptionExpiryReminderData): string => {
  const {
    storeName,
    ownerName,
    planName,
    isTrial = false,
    expiryDate,
    daysRemaining = 2,
    renewalUrl = 'https://merchant.masheco.com/dashboard/subscription',
  } = data;

  const recipientName = ownerName && ownerName.trim() ? ownerName.trim() : storeName || 'সম্মানিত মার্চেন্ট';

  const formattedDate = expiryDate
    ? new Date(expiryDate).toLocaleDateString('bn-BD', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'শীঘ্রই';

  const daysTextBangla = daysRemaining === 1 ? '১ দিন' : '২ দিন';
  const planLabel = isTrial ? `ফ্রি ট্রায়াল (${planName || '৫ দিন'})` : `${planName || 'স্ট্যান্ডার্ড'} প্ল্যান`;

  return `
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>সাবস্ক্রিপশনের মেয়াদ সংক্রান্ত জরুরি বিজ্ঞপ্তি - MASH ECO</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap');
      </style>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Hind Siliguri', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; -webkit-font-smoothing: antialiased;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 36px 12px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 15px 35px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">
              
              <!-- Header Warning Banner -->
              <tr>
                <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #0369a1 100%); padding: 36px 28px 30px 28px; text-align: center;">
                  <div style="display: inline-block; background-color: rgba(251, 191, 36, 0.15); padding: 6px 16px; border-radius: 9999px; margin-bottom: 14px; border: 1px solid rgba(251, 191, 36, 0.35);">
                    <span style="color: #fcd34d; font-size: 13px; font-weight: 700; letter-spacing: 0.5px;">⚠️ মেয়াদ শেষ হওয়ার সতর্কতা</span>
                  </div>
                  <h1 style="margin: 0 0 10px 0; color: #ffffff; font-size: 24px; font-weight: 700; line-height: 1.4;">
                    আপনার সাবস্ক্রিপশনের মেয়াদ আর মাত্র ${daysTextBangla} বাকি!
                  </h1>
                  <p style="margin: 0; color: #94a3b8; font-size: 15px; line-height: 1.5;">
                    অনলাইন স্টোর ও অর্ডার গ্রহণ নিরবচ্ছিন্ন রাখতে এখনই রিনিউ করুন
                  </p>
                </td>
              </tr>

              <!-- Content Body -->
              <tr>
                <td style="padding: 32px 28px;">
                  
                  <!-- Greeting -->
                  <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #334155;">
                    আসসালামু আলাইকুম <strong>${recipientName}</strong>,
                  </p>

                  <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.65; color: #475569;">
                    আপনার <strong>${storeName}</strong> স্টোরের বর্তমান <strong>${planLabel}</strong>-এর মেয়াদ আগামী <strong>${formattedDate}</strong> তারিখে শেষ হতে চলেছে। মেয়াদ শেষ হয়ে গেলে আপনার ওয়েবসাইটের অর্ডার প্রসেসিং ও কুরিয়ার অটোমেশন সাময়িকভাবে বাধাগ্রস্ত হতে পারে।
                  </p>

                  <!-- Subscription Details Box -->
                  <div style="background-color: #f8fafc; border-radius: 16px; padding: 22px; border: 1px solid #e2e8f0; margin-bottom: 28px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 15px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">
                      সাবস্ক্রিপশন বিবরণী
                    </h3>
                    
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 14px;">
                      <tr>
                        <td style="padding: 8px 0; color: #64748b; font-weight: 500;">স্টোরের নাম:</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #0f172a;">${storeName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #64748b; font-weight: 500;">বর্তমান প্ল্যান:</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #0284c7;">${planLabel}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #64748b; font-weight: 500;">মেয়াদ উত্তীর্ণের তারিখ:</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #e11d48;">${formattedDate}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #64748b; font-weight: 500;">অবশিষ্ট সময়:</td>
                        <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #d97706;">
                          <span style="background-color: #fef3c7; color: #92400e; padding: 2px 10px; border-radius: 9999px; font-size: 13px; font-weight: 700;">
                            আর মাত্র ${daysTextBangla}
                          </span>
                        </td>
                      </tr>
                    </table>
                  </div>

                  <!-- Why Renew Section -->
                  <div style="background-color: #eff6ff; border-left: 4px solid #0284c7; border-radius: 12px; padding: 16px; margin-bottom: 8px;">
                    <h4 style="margin: 0 0 6px 0; color: #1e3a8a; font-size: 14px; font-weight: 700;">
                      কেন সময়মতো রিনিউ করবেন?
                    </h4>
                    <ul style="margin: 0; padding-left: 18px; color: #3b82f6; font-size: 13px; line-height: 1.6;">
                      <li style="color: #334155; margin-bottom: 4px;">স্টোর সার্বক্ষণিক লাইভ থাকবে এবং কাস্টমাররা সহজে অর্ডার দিতে পারবেন</li>
                      <li style="color: #334155; margin-bottom: 4px;">কুরিয়ার অটোমেশন ও অ্যাবান্ডন্ড চেকআউট লিডস সক্রিয় থাকবে</li>
                      <li style="color: #334155;">ডাটা বা প্রোডাক্ট সেটিংসে কোনো ব্যাঘাত ঘটবে না</li>
                    </ul>
                  </div>

                </td>
              </tr>

              <!-- Footer Section -->
              <tr>
                <td style="background-color: #f1f5f9; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="margin: 0 0 8px 0; color: #475569; font-size: 13px; font-weight: 600;">
                    কোনো জিজ্ঞাসা থাকলে আমাদের জানান: <a href="mailto:support@masheco.com" style="color: #0284c7; text-decoration: none;">support@masheco.com</a>
                  </p>
                  <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                    © ${new Date().getFullYear()} MASH ECO. All rights reserved.<br>
                    আপনার ইকমার্স বিজনেসের বিশ্বস্ত সমাধান।
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

