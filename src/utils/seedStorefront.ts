import { Tenant } from '../modules/tenant/tenant.model';
import { Category } from '../modules/category/category.model';
import { Product } from '../modules/product/product.model';
import { Theme } from '../modules/theme/theme.model';

export const seedDemoStorefront = async () => {
  try {
    const slug = 'demo';
    const existingTenant = await Tenant.findOne({ slug });
    
    if (existingTenant) {
      console.log('✅ Demo tenant already exists.');
      return;
    }

    console.log('🌱 Seeding demo storefront...');

    // 1. Create Tenant
    const tenant = new Tenant({
      name: 'Demo MashEasy Store',
      slug,
      status: 'active',
      contactEmail: 'hello@demostore.com'
    });
    await tenant.save();
    const tenantId = tenant._id;

    // 2. Create Theme
    const theme = new Theme({
      tenantId,
      themeId: 'light',
      primaryColor: '#0ea5e9', // Sky blue
      fontFamily: 'Outfit'
    });
    await theme.save();

    // 3. Create Categories
    const catLaptops = new Category({ tenantId, name: 'Laptops', slug: 'laptops' });
    const catPhones = new Category({ tenantId, name: 'Smartphones', slug: 'smartphones' });
    const catAudio = new Category({ tenantId, name: 'Audio', slug: 'audio' });
    
    await Promise.all([catLaptops.save(), catPhones.save(), catAudio.save()]);

    // 4. Create Products
    const products = [
      {
        tenantId,
        title: 'MacBook Pro 16" M3 Max',
        slug: 'macbook-pro-16-m3',
        description: 'The ultimate pro laptop with the incredibly fast M3 Max chip. 48GB Unified Memory, 1TB SSD.',
        price: 3499,
        comparePrice: 3699,
        stock: 10,
        categoryId: catLaptops._id,
        status: 'published',
        images: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&q=80&w=800']
      },
      {
        tenantId,
        title: 'iPhone 15 Pro Titanium',
        slug: 'iphone-15-pro',
        description: 'Forged in titanium. Features the A17 Pro chip and a customizable Action button.',
        price: 999,
        comparePrice: 1099,
        stock: 50,
        categoryId: catPhones._id,
        status: 'published',
        images: ['https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&q=80&w=800']
      },
      {
        tenantId,
        title: 'Sony WH-1000XM5 Headphones',
        slug: 'sony-wh-1000xm5',
        description: 'Industry leading noise cancellation. 30 hours of battery life.',
        price: 348,
        comparePrice: 399,
        stock: 25,
        categoryId: catAudio._id,
        status: 'published',
        images: ['https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&q=80&w=800']
      },
      {
        tenantId,
        title: 'Dell XPS 15 OLED',
        slug: 'dell-xps-15',
        description: 'Stunning 3.5K OLED touch display. Intel Core i9, 32GB RAM, RTX 4070.',
        price: 2499,
        stock: 15,
        categoryId: catLaptops._id,
        status: 'published',
        images: ['https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&q=80&w=800']
      }
    ];

    await Product.insertMany(products);
    console.log('✅ Demo storefront seeded successfully!');

  } catch (error) {
    console.error('❌ Failed to seed demo storefront:', error);
  }
};
