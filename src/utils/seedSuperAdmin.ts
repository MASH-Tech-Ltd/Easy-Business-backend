import config from '../config/index';
import { User } from '../modules/auth/auth.model';
import { Referral } from '../modules/referral/referral.model';

export const seedSuperAdmin = async () => {
  try {
    const superAdminEmail = config.superAdmin.email;
    const superAdminPassword = config.superAdmin.password;

    if (!superAdminEmail || !superAdminPassword) {
      console.warn('Authority Person credentials not provided. Skipping process...');
      return;
    }

    // Only select _id to avoid hydrating the full document. 
    // This prevents Mongoose from crashing if there are old legacy string tokens in the DB.
    const existingSuperAdmin = await User.findOne({ email: superAdminEmail }).select('_id');

    if (!existingSuperAdmin) {
      const superAdmin = new User({
        name: 'Authority Person',
        email: superAdminEmail,
        password: superAdminPassword,
        role: 'super_admin',
        isEmailVerified: true
      });

      await superAdmin.save();
      console.log('✅ Authority Person seeded successfully.');
    } else {
      // The user requested to "skip if admin email exist".
      // We will no longer force-update the password on every server restart.
      console.log('✅ Authority Person already exists. Skipping process.');
    }

    // Auto-seed default referral code WELCOME10 if no referral codes exist
    const referralCount = await Referral.countDocuments();
    if (referralCount === 0) {
      await Referral.create({
        code: 'WELCOME10',
        extraDays: 10,
        description: 'Welcome promotion: +10 extra days free trial for new merchants',
        referrerName: 'Platform Promo',
        isActive: true,
        maxUses: null,
      });
      console.log('✅ Default referral code WELCOME10 (+10 days extra trial) seeded successfully.');
    }
  } catch (error) {
    console.error('❌ Failed to seed Authority Person or default referral:', error);
  }
};
