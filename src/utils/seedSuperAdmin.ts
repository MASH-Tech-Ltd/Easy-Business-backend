import config from '../config/index';
import { User } from '../modules/auth/auth.model';

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
  } catch (error) {
    console.error('❌ Failed to seed Authority Person:', error);
  }
};
