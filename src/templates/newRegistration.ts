export const newRegistrationTemplate = (userEmail: string, userName: string): string => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New User Registration</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; color: #333333;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f7f6; padding: 40px 0;">
        <tr>
          <td align="center">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);">
              
              <!-- Header -->
              <tr>
                <td align="center" style="background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%); padding: 40px 20px;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">New User Alert</h1>
                  <p style="color: #e0e7ff; margin: 10px 0 0 0; font-size: 16px;">A new user has joined the platform</p>
                </td>
              </tr>
              
              <!-- Body -->
              <tr>
                <td style="padding: 40px 40px 30px 40px;">
                  <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #4b5563;">
                    Hello Admin,
                  </p>
                  <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #4b5563;">
                    Great news! A new user has just completed their registration. Here are the details of the new account:
                  </p>
                  
                  <!-- Info Box -->
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <tr>
                      <td style="padding: 20px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                          <tr>
                            <td width="30%" style="padding-bottom: 12px; color: #64748b; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Name</td>
                            <td width="70%" style="padding-bottom: 12px; color: #0f172a; font-size: 16px; font-weight: 500;">${userName || 'N/A'}</td>
                          </tr>
                          <tr>
                            <td width="30%" style="color: #64748b; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Email</td>
                            <td width="70%" style="color: #0f172a; font-size: 16px; font-weight: 500;">
                              <a href="mailto:${userEmail}" style="color: #4f46e5; text-decoration: none;">${userEmail}</a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  
                  <p style="margin: 30px 0 0 0; font-size: 16px; line-height: 1.6; color: #4b5563;">
                    Log in to your admin dashboard to review their account and manage permissions.
                  </p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0; text-align: center;">
                  <p style="margin: 0; font-size: 14px; color: #64748b;">
                    &copy; ${new Date().getFullYear()} Platform Admin. All rights reserved.
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
