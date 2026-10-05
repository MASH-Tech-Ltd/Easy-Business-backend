export const welcomeUserTemplate = (userName: string): string => {
  const loginUrl = 'https://merchant.masheco.com';
  const name = userName && userName.trim() ? userName.trim() : 'সম্মানিত গ্রাহক';

  return `
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MASH ECO-তে আপনাকে স্বাগতম</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap');
      </style>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Hind Siliguri', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; color: #1e293b; -webkit-font-smoothing: antialiased;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f7f6; padding: 40px 15px;">
        <tr>
          <td align="center">
            <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);">
              
              <!-- Body Content -->
              <tr>
                <td style="padding: 30px 20px 25px 20px; background-color: #ffffff;">
                  <p style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #0f172a; line-height: 1.6;">
                    হ্যালো ${name},
                  </p>
                  
                  <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.8; color: #334155;">
                    MASH ECO-তে আপনাকে স্বাগতম!
                  </p>

                  <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.8; color: #334155;">
                    আপনার ব্যবসার অনলাইন যাত্রাকে আরও সহজ ও সুন্দর করতে <strong>MASH ECO</strong> আপনার পাশে আছে।
                  </p>

                  <!-- Highlight Box -->
                  <div style="background-color: #f8fafc; border-left: 4px solid #6366f1; border-radius: 8px; padding: 14px 16px; margin: 20px 0;">
                    <p style="margin: 0; font-size: 15px; line-height: 1.8; color: #475569;">
                      আপনার স্টোর সেটআপ শুরু করতে প্রথমে বিজনেস ডিটেইলস ও প্রয়োজনীয় সেটিংস ঠিকঠাক করে নিন। এরপর আপনার পছন্দ অনুযায়ী ক্যাটাগরি ও প্রোডাক্ট তৈরি করুন, প্রয়োজনীয় তথ্য যুক্ত করুন এবং নিজের ব্র্যান্ড ও প্রোডাক্ট দিয়ে সাজিয়ে ফেলুন আপনার নিজস্ব অনলাইন স্টোর।
                    </p>
                  </div>

                  <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.8; color: #334155;">
                    আপনার ব্যবসাকে অনলাইনে আরও সুন্দরভাবে এগিয়ে নিতে MASH ECO-এর সঙ্গে আপনার যাত্রা সফল হোক—এই শুভকামনা রইল।
                  </p>

                  <!-- CTA Button -->
                  <div style="text-align: center; margin: 25px 0 20px 0;">
                    <a href="${loginUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 10px; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);">
                      আপনার স্টোর সেটআপ শুরু করুন
                    </a>
                  </div>

                  <p style="margin: 20px 0 0 0; font-size: 15px; line-height: 1.8; color: #64748b; background-color: #fffbe6; border: 1px solid #ffe58f; padding: 12px 14px; border-radius: 8px;">
                    কোনো সমস্যা বা অসুবিধার সম্মুখীন হলে অবশ্যই আমাদের সাপোর্ট টিমের সঙ্গে যোগাযোগ করুন। আপনার সমস্যাটি যথাযথভাবে পর্যালোচনা করে প্রয়োজনীয় সমাধান দেওয়ার চেষ্টা করা হবে।
                  </p>
                </td>
              </tr>
              
              <!-- Footer Section -->
              <tr>
                <td style="background-color: #0f172a; padding: 24px 20px; text-align: center; border-top: 1px solid #1e293b;">
                  <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 700; color: #38bdf8;">
                    MASH ECO — আপনার ব্যবসা, আপনার অনলাইন স্টোর।
                  </p>
                  <p style="margin: 10px 0 0 0; font-size: 13px; color: #94a3b8;">
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
