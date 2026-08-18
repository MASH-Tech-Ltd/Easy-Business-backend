import mongoose from 'mongoose';
import { User } from './src/modules/auth/auth.model';
import { AuthService } from './src/modules/auth/auth.service';
import config from './src/config';

mongoose.connect(config.database_url as string).then(async () => {
  const existing = await User.findOne({ email: 'merchant@demo.com' });
  if (existing) {
    console.log('Merchant already exists: merchant@demo.com / password123');
  } else {
    await AuthService.register({
      name: 'Demo Merchant',
      email: 'merchant@demo.com',
      password: 'password123',
      role: 'tenant_admin'
    });
    console.log('Created merchant@demo.com / password123');
  }
  process.exit(0);
});
