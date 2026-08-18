import config from '../config/index';
import { User } from '../modules/auth/auth.model';

export const seedSuperAdmin = async () => {
  try {
    const superAdminEmail = config.super_admin_email;
    const superAdminPassword = config.super_admin_password;

    if (!superAdminEmail || !superAdminPassword) {
      console.warn('Super Admin credentials not provided in env. Skipping seeder.');
      return;
    }

    // Check if the super admin already exists
    const existingSuperAdmin = await User.findOne({ email: superAdminEmail });

    if (!existingSuperAdmin) {
      const superAdmin = new User({
        name: 'Super Admin',
        email: superAdminEmail,
        password: superAdminPassword,
        role: 'super_admin',
        isEmailVerified: true
      });

      await superAdmin.save();
      console.log('✅ Super Admin seeded successfully from environment variables.');
    } else {
      // If the super admin exists, we can optionally update their password to match the env file
      // if we want the .env file to be the single source of truth for the password.
      // We need to compare and update if they want to 'update the password'
      existingSuperAdmin.password = superAdminPassword;
      await existingSuperAdmin.save();
      console.log('✅ Super Admin credentials verified/updated from environment variables.');
    }
  } catch (error) {
    console.error('❌ Failed to seed Super Admin:', error);
  }
};
