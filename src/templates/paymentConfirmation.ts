export interface PaymentConfirmationEmailData {
  storeName: string;
  ownerName?: string | undefined;
  purposeTitle: string;
  amount: number;
  provider: string;
  senderNumber: string;
  transactionId: string;
  approvalDate?: string | Date | undefined;
  adminFeedback?: string | undefined;
}

export const paymentConfirmationTemplate = (data: PaymentConfirmationEmailData): string => {
  const {
    storeName,
    ownerName,
    purposeTitle,
    amount,
    provider,
    senderNumber,
    transactionId,
    approvalDate,
    adminFeedback,
  } = data;

  const loginUrl = 'https://merchant.masheco.com';
  const recipientName = ownerName && ownerName.trim() ? ownerName.trim() : storeName || 'সম্মানিত মার্চেন্ট';
  const formattedDate = approvalDate
    ? new Date(approvalDate).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : new Date().toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

  return `
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>পেমেন্ট অনুমোদন নিশ্চিতকরণ - MASH ECO</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap');
      </style>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Hind Siliguri', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b; -webkit-font-smoothing: antialiased;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 36px 12px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 15px 35px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">
              
              <!-- Header Banner -->
              <tr>
                <td style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%); padding: 36px 28px 30px 28px; text-align: center;">
                  <div style="display: inline-block; background-color: rgba(255, 255, 255, 0.12); padding: 6px 16px; border-radius: 9999px; margin-bottom: 12px; border: 1px solid rgba(255, 255, 255, 0.2);">
                    <span style="color: #a5b4fc; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;">Payment Receipt & Confirmation</span>
                  </div>
                  <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 26px; font-weight: 700; line-height: 1.3;">
                    পেমেন্ট সফলভাবে অনুমোদিত হয়েছে!
                  </h1>
                  <p style="margin: 0; color: #c7d2fe; font-size: 15px; line-height: 1.5;">
                    MASH ECO প্ল্যাটফর্মে আপনার পেমেন্ট ভেরিফিকেশন সম্পন্ন হয়েছে।
                  </p>
                </td>
              </tr>

              <!-- Status Ribbon -->
              <tr>
                <td style="background-color: #ecfdf5; border-bottom: 1px solid #a7f3d0; padding: 12px 24px; text-align: center;">
                  <span style="display: inline-block; width: 10px; height: 10px; background-color: #10b981; border-radius: 50%; margin-right: 8px; vertical-align: middle;"></span>
                  <span style="color: #065f46; font-size: 14px; font-weight: 700; vertical-align: middle;">STATUS: APPROVED &amp; VERIFIED</span>
                </td>
              </tr>

              <!-- Main Content Area -->
              <tr>
                <td style="padding: 32px 28px 24px 28px; background-color: #ffffff;">
                  <p style="margin: 0 0 16px 0; font-size: 17px; font-weight: 600; color: #0f172a; line-height: 1.6;">
                    প্রিয় <strong>${recipientName}</strong>,
                  </p>
                  
                  <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.7; color: #475569;">
                    আপনার স্টোর <strong>${storeName}</strong>-এর জন্য প্রেরিত পেমেন্টটি আমাদের  টিম কর্তৃক সফলভাবে যাচাই ও নিশ্চিত করা হয়েছে। আপনার সংশ্লিষ্ট সার্ভিস/প্যাকেজটি সক্রিয় করা হয়েছে।
                  </p>

                  <!-- Invoice Details Card -->
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; margin-bottom: 24px;">
                    <tr>
                      <td style="background-color: #f1f5f9; padding: 12px 18px; border-bottom: 1px solid #e2e8f0;">
                        <span style="color: #475569; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">পেমেন্ট বিবরণ (Payment Details)</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 16px 18px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="6">
                          <tr>
                            <td width="42%" style="font-size: 14px; color: #64748b; font-weight: 500;">স্টোরের নাম:</td>
                            <td width="58%" style="font-size: 14px; color: #0f172a; font-weight: 700;">${storeName}</td>
                          </tr>
                          <tr>
                            <td style="font-size: 14px; color: #64748b; font-weight: 500;">উদ্দেশ্য / সার্ভিস:</td>
                            <td style="font-size: 14px; color: #4338ca; font-weight: 700;">${purposeTitle}</td>
                          </tr>
                          <tr>
                            <td style="font-size: 14px; color: #64748b; font-weight: 500;">পরিশোধিত অর্থ:</td>
                            <td style="font-size: 18px; color: #059669; font-weight: 800;">৳ ${Number(amount).toLocaleString('en-BD')} BDT</td>
                          </tr>
                          <tr>
                            <td style="font-size: 14px; color: #64748b; font-weight: 500;">পেমেন্ট মেথড:</td>
                            <td style="font-size: 14px; color: #0f172a; font-weight: 600;">${provider}</td>
                          </tr>
                          <tr>
                            <td style="font-size: 14px; color: #64748b; font-weight: 500;">প্রেরক নম্বর:</td>
                            <td style="font-size: 14px; color: #0f172a; font-family: monospace; font-weight: 600;">${senderNumber}</td>
                          </tr>
                          <tr>
                            <td style="font-size: 14px; color: #64748b; font-weight: 500;">ট্রানজেকশন আইডি (TrxID):</td>
                            <td style="font-size: 14px; color: #0f172a; font-family: monospace; font-weight: 700; background-color: #fef08a; padding: 2px 6px; border-radius: 4px; display: inline-block;">${transactionId}</td>
                          </tr>
                          <tr>
                            <td style="font-size: 14px; color: #64748b; font-weight: 500;">অনুমোদনের সময়:</td>
                            <td style="font-size: 13px; color: #475569;">${formattedDate}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  ${
                    adminFeedback
                      ? `
                  <!-- Admin Feedback Note -->
                  <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px;">
                    <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #1d4ed8; letter-spacing: 0.5px;">অ্যাডমিন নোট / বার্তা:</p>
                    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #1e40af;">
                      ${adminFeedback}
                    </p>
                  </div>
                  `
                      : ''
                  }

                  <!-- Action Button -->
                  <div style="text-align: center; margin: 30px 0 24px 0;">
                    <a href="${loginUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%); color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 34px; border-radius: 12px; box-shadow: 0 6px 20px rgba(79, 70, 229, 0.35); letter-spacing: 0.3px;">
                      মার্চেন্ট ড্যাশবোর্ডে প্রবেশ করুন
                    </a>
                  </div>

                  <!-- Help & Support -->
                  <div style="background-color: #faf5ff; border: 1px dashed #d8b4fe; border-radius: 12px; padding: 14px 18px; margin-top: 24px; text-align: center;">
                    <p style="margin: 0; font-size: 13px; color: #6b21a8; line-height: 1.6;">
                      আপনার কোনো প্রশ্ন বা সহায়তার প্রয়োজন হলে অনুগ্রহ করে ড্যাশবোর্ডের <strong>সাপোর্ট টিকেট</strong> সেকশন থেকে আমাদের মেসেজ দিন অথবা সরাসরি সাপোর্ট টিমের সাথে যোগাযোগ করুন।
                    </p>
                  </div>
                </td>
              </tr>
              
              <!-- Footer Section -->
              <tr>
                <td style="background-color: #0f172a; padding: 26px 24px; text-align: center; border-top: 1px solid #1e293b;">
                  <p style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: #38bdf8;">
                    MASH ECO — E-commerce Builder Platform
                  </p>
                  <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.6;">
                    আপনার ব্যবসার বিশ্বস্ত ডিজিটাল সঙ্গী।
                  </p>
                  <p style="margin: 14px 0 0 0; font-size: 12px; color: #64748b;">
                    &copy; ${new Date().getFullYear()} MASH ECO. All rights reserved.
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
