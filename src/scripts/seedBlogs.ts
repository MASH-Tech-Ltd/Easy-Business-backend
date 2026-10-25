import mongoose from 'mongoose';
import config from '../config/index';
import { BlogService } from '../modules/blog/blog.service';

const run = async () => {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(config.database.url as string);
    console.log('Database connected.');

    console.log('Force re-seeding blogs with clean formatted content...');
    await BlogService.seedInitialBlogs(true);
    console.log('✅ Re-seed completed successfully!');
  } catch (err) {
    console.error('Failed to seed blogs:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

run();
