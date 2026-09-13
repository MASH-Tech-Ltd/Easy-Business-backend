export const resetPasswordTemplate = (otp: string, frontendUrl: string): string => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
      <p style="color: #555; font-size: 16px;">Hello,</p>
      <p style="color: #555; font-size: 16px;">We received a request to reset your password. Use the following OTP to reset it. This OTP is valid for 10 minutes.</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4CAF50; padding: 10px 20px; border: 2px dashed #4CAF50; border-radius: 5px;">
          ${otp}
        </span>
      </div>
      
      <p style="color: #555; font-size: 16px;">If you did not request this, please ignore this email.</p>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">
        &copy; ${new Date().getFullYear()} Our Platform. All rights reserved.
      </p>
    </div>
  `;
};
