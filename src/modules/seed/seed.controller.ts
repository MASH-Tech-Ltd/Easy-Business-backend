import { Request, Response } from "express";
import { Category } from "../category/category.model";
import { Product } from "../product/product.model";
import { Types } from "mongoose";
import ApiResponse from "../../utils/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";

const img = (url: string) => ({
  public_id: "seed/placeholder",
  secure_url: url,
});
const vid = () => ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"];
const dim = () => ({ length: 15, width: 10, height: 5 });

import { abstractCategories, abstractProducts } from "./seed.data";

function generateSeedData(lang: "en" | "bn") {
  const categories = abstractCategories.map((c) => ({
    _tempId: c.id,
    name: c[lang],
    description:
      lang === "en"
        ? `Top quality ${c.en} products.`
        : `সেরা মানের ${c.bn} পণ্য।`,
    image: img(c.img),
    status: "ACTIVE",
  }));

  const productsFn = async (
    catMap: Record<string, Types.ObjectId>,
    tenantId: Types.ObjectId,
  ) => {
    // Variables for seeding quantities - change these to adjust seed amounts
    // const PRODUCTS_PER_CATEGORY = 1000;
    const PRODUCTS_PER_CATEGORY = 60;
    const MAX_TOTAL_PRODUCTS = 50000;
    const BATCH_SIZE = 5000;

    const prodsByCat: Record<string, (typeof abstractProducts)[0][]> = {};
    for (const p of abstractProducts) {
      if (!prodsByCat[p.cat]) prodsByCat[p.cat] = [];
      prodsByCat[p.cat]!.push(p);
    }

    let batch: any[] = [];
    let totalCount = 0;

    for (const category of abstractCategories) {
      const catId = category.id;
      let templates = prodsByCat[catId];
      
      // Fallback to all templates if this specific category has no templates defined
      if (!templates || templates.length === 0) {
        templates = abstractProducts;
      }

      for (let i = 0; i < PRODUCTS_PER_CATEGORY; i++) {
        if (totalCount >= MAX_TOTAL_PRODUCTS) break;

        const p = templates[i % templates.length];
        const p2 = templates[(i + 1) % templates.length];
        const p3 = templates[(i + 2) % templates.length];
        
        if (!p) continue;

        const data = (p as any)[lang];

        const randomModel = Math.floor(Math.random() * 9000) + 1000;
        const categoryBnName = abstractCategories.find(c => c.id === p.cat)?.bn || "পণ্য";
        const newTitle = lang === "en" ? `${data.title} - M${randomModel}` : `${p.brand} ${categoryBnName} - মডেল M${randomModel}`;
        const priceVariance = Math.random() * 0.2 + 0.9;
        const originalPrice = Math.floor(p.price * priceVariance);
        const discountedPrice = Math.floor(originalPrice * 0.9);

        const shortDescEn = `${data.desc}. This premium product offers unparalleled performance and reliability. Designed to meet your everyday needs with excellence.`;
        const shortDescBn = `${data.desc}. এই প্রিমিয়াম পণ্যটি অতুলনীয় পারফরম্যান্স এবং নির্ভরযোগ্যতা প্রদান করে। এটি আপনার দৈনন্দিন চাহিদা মেটানোর জন্য চমৎকারভাবে ডিজাইন করা হয়েছে।`;
        
        const descEn = `<h3>${newTitle}</h3><p>${data.desc}</p><p>Experience the ultimate in quality with this premium product by <strong>${p.brand}</strong>. Designed with meticulous attention to detail and built to last, it stands out in both performance and aesthetics.</p><ul><li>Constructed from high-quality, durable materials</li><li>Optimized for maximum efficiency and longevity</li><li>Backed by our comprehensive satisfaction guarantee</li></ul><p>Upgrade your lifestyle today with the ${newTitle}.</p>`;
        const descBn = `<h3>${newTitle}</h3><p>${data.desc}</p><p><strong>${p.brand}</strong> এর এই প্রিমিয়াম পণ্যের মাধ্যমে সেরা মানের অভিজ্ঞতা উপভোগ করুন। অত্যন্ত নিখুঁতভাবে ডিজাইন করা এবং দীর্ঘস্থায়ী হওয়ার জন্য তৈরি করা এই পণ্যটি পারফরম্যান্স এবং সৌন্দর্যের দিক থেকে অনন্য।</p><ul><li>উন্নত মানের, টেকসই উপকরণ দিয়ে তৈরি</li><li>সর্বোচ্চ দক্ষতা এবং দীর্ঘস্থায়িত্বের জন্য তৈরি</li><li>আমাদের ১০০% সন্তুষ্টি গ্যারান্টি দ্বারা সমর্থিত</li></ul><p>আজই ${newTitle} এর মাধ্যমে আপনার জীবনযাত্রাকে আপগ্রেড করুন।</p>`;

        if (catMap[catId]) {
          batch.push({
            title: newTitle,
            shortDescription: lang === "en" ? shortDescEn : shortDescBn,
            description: lang === "en" ? descEn : descBn,
            images: [
              img(p.img),
              img(p2 ? p2.img : p.img),
              img(p3 ? p3.img : p.img)
            ],
            videos: vid(),
            originalPrice,
            discountedPrice,
            saveAmount: originalPrice - discountedPrice,
            badgeText:
              i % 5 === 0
                ? lang === "en"
                  ? "Best Seller"
                  : "বেস্ট সেলার"
                : lang === "en"
                  ? "New Arrival"
                  : "নতুন আগমন",
            brand: p.brand,
            stock: 50 + Math.floor(Math.random() * 100),
            salesCount: Math.floor(Math.random() * 500),
            isAuthentic: true,
            features:
              lang === "en"
                ? ["Premium Quality Construction", "100% Authentic Brand", "1 Year Extended Warranty", "Eco-friendly Packaging"]
                : ["প্রিমিয়াম কোয়ালিটি নির্মাণ", "১০০% আসল ব্র্যান্ড", "১ বছরের বর্ধিত ওয়ারেন্টি", "পরিবেশ বান্ধব প্যাকেজিং"],
            specifications: [
              {
                group: lang === "en" ? "General" : "সাধারণ",
                entries: [
                  { name: lang === "en" ? "Brand" : "ব্র্যান্ড", value: p.brand },
                  { name: lang === "en" ? "Model" : "মডেল", value: `M${randomModel}` },
                  { name: lang === "en" ? "Warranty" : "ওয়ারেন্টি", value: lang === "en" ? "1 Year" : "১ বছর" },
                  { name: lang === "en" ? "Condition" : "অবস্থা", value: lang === "en" ? "Brand New" : "সম্পূর্ণ নতুন" },
                  { name: lang === "en" ? "Weight" : "ওজন", value: `${(Math.random() * 2 + 0.1).toFixed(2)} kg` },
                  { name: lang === "en" ? "Origin" : "উৎস", value: lang === "en" ? "Imported" : "আমদানিকৃত" },
                  { name: lang === "en" ? "Material" : "উপাদান", value: lang === "en" ? "Premium Grade" : "প্রিমিয়াম গ্রেড" }
                ],
              },
            ],
            weight: 0.5,
            dimensions: dim(),
            condition: "New",
            status: "ACTIVE",
            sku: `SKU-${catId.toUpperCase()}-${totalCount}-${randomModel}`,
            unit: lang === "en" ? "piece" : "পিস",
            categoryId: catMap[catId],
            tenantId,
          });
        }

        totalCount++;

        // Batch insert to prevent OOM
        if (batch.length >= BATCH_SIZE) {
          await Product.insertMany(batch);
          batch = []; // Free memory
        }
      }
      if (totalCount >= MAX_TOTAL_PRODUCTS) break;
    }

    // Insert any remaining items in the last batch
    if (batch.length > 0) {
      await Product.insertMany(batch);
      batch = [];
    }

    return totalCount;
  };

  return { categories, productsFn };
}

const SEED_DATA = {
  en: generateSeedData("en"),
  bn: generateSeedData("bn"),
};

const seedDemoData = asyncHandler(async (req: Request, res: Response) => {
  const tenantId: Types.ObjectId = (req as any).user.tenantId;
  const lang = (req.query.lang as "en" | "bn") || "en";
  const type = (req.query.type as string) || "all";

  const dataset = SEED_DATA[lang] || SEED_DATA.en;

  const typeMap: Record<string, string[]> = {
    electronics: [
      "smartphones",
      "laptops",
      "audio",
      "cameras",
      "tvs",
      "gaming",
      "smartwatches",
      "accessories",
      "drones",
      "tablets",
      "networking",
      "components",
      "monitors",
      "printers",
      "smarthome",
    ],
    fashion: [
      "mens_wear",
      "womens_wear",
      "kids_wear",
      "shoes",
      "watches",
      "bags",
      "jewelry",
      "sunglasses",
      "beauty",
      "fragrances",
      "activewear",
      "swimwear",
      "winterwear",
      "intimates",
      "fashion_acc",
    ],
    lifestyle: [
      "furniture",
      "home_decor",
      "sports",
      "groceries",
      "books",
      "stationery",
      "kitchenware",
      "gardening",
      "pet_supplies",
      "automotive",
      "toys",
      "fitness",
      "health",
      "tools",
      "bedding",
    ],
  };

  const allowedCategories =
    type === "all" || !typeMap[type] ? null : typeMap[type];

  const existingCats = await Category.countDocuments({ tenantId });
  const existingProds = await Product.countDocuments({ tenantId });

  if (existingCats > 0 || existingProds > 0) {
    return ApiResponse.sendError(
      res,
      409,
      `Store already has data (${existingCats} categories, ${existingProds} products). Use the reset endpoint to clear data before re-seeding.`,
    );
  }

  const filteredCategories = dataset.categories.filter(
    (c) => !allowedCategories || allowedCategories.includes(c._tempId),
  );

  const categoriesToInsert = filteredCategories.map((cat) => ({
    name: cat.name,
    description: cat.description,
    image: cat.image,
    status: cat.status,
    tenantId,
  }));

  const categoryDocs = await Category.insertMany(categoriesToInsert);

  const categoryMap: Record<string, Types.ObjectId> = {};
  for (let i = 0; i < categoryDocs.length; i++) {
    const tempId = filteredCategories[i]?._tempId;
    const doc = categoryDocs[i];
    if (tempId && doc) {
      categoryMap[tempId] = doc._id as Types.ObjectId;
    }
  }

  const productsCreated = await dataset.productsFn(categoryMap, tenantId);

  ApiResponse.sendSuccess(res, 201, "Demo data seeded successfully!", {
    categoriesCreated: categoryDocs.length,
    productsCreated,
    message:
      "Your store now has demo categories and products. Visit your storefront to see them live!",
  });
});

import { Tenant } from "../tenant/tenant.model";
import { User } from "../auth/auth.model";
import { Subscription } from "../subscription/subscription.model";
import { Theme } from "../theme/theme.model";
import { GlobalSetting } from "../system/globalSetting.model";
import config from "../../config";

const DEMO_STORE_CONFIGS: Record<string, any> = {
  'design-01': {
    defaultSubdomain: 'store1',
    name: 'Electro MegaStore',
    themeId: 'design-01',
    primaryColor: '#5022C3',
    logo: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=250&h=250&fit=crop&q=80',
    description: 'Electro is Bangladesh\'s premier destination for certified original electronics, flagship smartphones, authentic audio gears, and smart home appliances with official nationwide warranty.',
    banner: {
      title: 'Next-Gen Electronics & Mega Deals',
      subtitle: 'Official Electro Flagship Store',
      description: 'Discover top smartphones, computing powerhouses, and high-fidelity audio equipment with official brand warranties.',
      buttonText: 'Browse Mega Deals',
      buttonLink: '/categories',
      showAnnouncement: true,
      announcementText: 'Flash Sale Live: Get up to 40% OFF on all computing and audio gear + Free Island-wide Delivery!',
      isSliding: true,
      announcementBgColor: '#0f172a',
      announcementTextColor: '#ffffff',
      images: [
        { public_id: 'seed/banner-1', secure_url: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=1600&q=80' },
        { public_id: 'seed/banner-2', secure_url: 'https://images.unsplash.com/photo-1593642702821-c8da6771f0c6?w=1600&q=80' },
        { public_id: 'seed/banner-3', secure_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1600&q=80' },
      ],
    },
    footer: {
      socialLinks: { facebook: 'https://facebook.com/masheco', youtube: 'https://youtube.com/@masheco', tiktok: 'https://tiktok.com/@masheco' },
      contactInfo: { email: 'store1@masheco.com', phone: '+880 1800-000001', address: 'Level 4, Mash Tech Tower, Banani, Dhaka' },
      policies: {
        aboutUs: 'ElectroClassic is your premier destination for certified original electronics, smartphones, and consumer tech in Bangladesh.',
        privacyPolicy: 'Your privacy is our priority. All transactions and customer data are encrypted and strictly confidential.',
        termsAndConditions: 'Standard 7-day replacement guarantee applies on all manufacturing defects with warranty card.',
        returnPolicy: 'Hassle-free 7-day return policy for unused, sealed electronic devices.'
      },
      copyrightText: '© 2026 ElectroClassic Demo Store. All rights reserved. Powered by MASH ECO.'
    }
  },
  'design-02': {
    defaultSubdomain: 'store2',
    name: 'MinimalTech Studio',
    themeId: 'design-02',
    primaryColor: '#3b82f6',
    logo: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=250&h=250&fit=crop&q=80',
    description: 'Curated collection of everyday productivity devices, wireless smart accessories, and sleek workspace tech with minimalist design aesthetics.',
    banner: {
      title: 'Clean Simplicity, Peak Performance',
      subtitle: 'Minimalist Everyday Gadgets & Gear',
      description: 'Curated collection of everyday productivity devices, wireless smart accessories, and sleek workspace tech.',
      buttonText: 'Explore Collection',
      buttonLink: '/categories',
      showAnnouncement: true,
      announcementText: 'Free express shipping across Bangladesh on orders over ৳1,500.',
      isSliding: true,
      announcementBgColor: '#0f172a',
      announcementTextColor: '#ffffff',
      images: [
        { public_id: 'seed/banner-4', secure_url: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=1600&q=80' },
        { public_id: 'seed/banner-5', secure_url: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1600&q=80' },
        { public_id: 'seed/banner-6', secure_url: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=1600&q=80' },
      ],
    },
    footer: {
      socialLinks: { facebook: 'https://facebook.com/masheco', youtube: 'https://youtube.com/@masheco', tiktok: 'https://tiktok.com/@masheco' },
      contactInfo: { email: 'store2@masheco.com', phone: '+880 1800-000002', address: 'Gulshan 2, Dhaka, Bangladesh' },
      policies: {
        aboutUs: 'MinimalTech provides sleek, focused designed for the modern lifestyle and work aesthetic.',
        privacyPolicy: 'We strictly protect customer information under global data protection standards.',
        termsAndConditions: 'All products come with genuine manufacturer warranty coverage.',
        returnPolicy: 'Easy return within 7 days in original packaging.'
      },
      copyrightText: '© 2026 MinimalTech Demo Store. All rights reserved. Powered by MASH ECO.'
    }
  },
  'design-03': {
    defaultSubdomain: 'store3',
    name: 'CyberGadgets Studio',
    themeId: 'design-03',
    primaryColor: '#06b6d4',
    logo: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=250&h=250&fit=crop&q=80',
    description: 'Next-generation cyber gadgets, futuristic gaming rigs, mechanical peripherals, and high-frequency audio components engineered for enthusiasts.',
    banner: {
      title: 'Extreme Gaming & Cyber Rigs',
      subtitle: 'High-Octane Tech Arsenal',
      description: 'Unleash top-tier graphics cards, custom mechanical peripherals, studio microphones, and liquid-cooled hardware.',
      buttonText: 'Gear Up Now',
      buttonLink: '/categories',
      showAnnouncement: true,
      announcementText: 'Cyber Week: 0% EMI available on all custom gaming rigs and RTX graphics series!',
      isSliding: true,
      announcementBgColor: '#050505',
      announcementTextColor: '#06b6d4',
      images: [
        { public_id: 'seed/banner-7', secure_url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1600&q=80' },
        { public_id: 'seed/banner-8', secure_url: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=1600&q=80' },
        { public_id: 'seed/banner-9', secure_url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1600&q=80' },
      ],
    },
    footer: {
      socialLinks: { facebook: 'https://facebook.com/masheco', youtube: 'https://youtube.com/@masheco', tiktok: 'https://tiktok.com/@masheco' },
      contactInfo: { email: 'store3@masheco.com', phone: '+880 1800-000003', address: 'Dhanmondi 27, Dhaka, Bangladesh' },
      policies: {
        aboutUs: 'CyberGadgets is the definitive gear hub for pro esports athletes and high-demand creators.',
        privacyPolicy: 'Your credentials and transaction integrity are shielded by military-grade encryption.',
        termsAndConditions: 'Official component warranty with direct manufacturer RMA support.',
        returnPolicy: '14-day replacement guarantee on verified technical issues.'
      },
      copyrightText: '© 2026 CyberGadgets Demo Studio. All rights reserved. Powered by MASH ECO.'
    }
  },
  'design-04': {
    defaultSubdomain: 'store4',
    name: 'ApexElectronics Pro',
    themeId: 'design-04',
    primaryColor: '#111827',
    logo: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=250&h=250&fit=crop&q=80',
    description: 'Precision workstation hardware, creator grade 4K displays, professional studio audio, and heavy-duty storage arrays for enterprise workflows.',
    banner: {
      title: 'Engineered for Pro Creators',
      subtitle: 'Precision Grid & Spec Storefront',
      description: 'Explore high-performance 4K displays, mobile workstations, mirrorless cameras, and heavy-duty storage arrays.',
      buttonText: 'View Pro Hardware',
      buttonLink: '/categories',
      showAnnouncement: true,
      announcementText: 'Same-day express dispatch for all orders placed before 2 PM inside Dhaka.',
      isSliding: true,
      announcementBgColor: '#111827',
      announcementTextColor: '#ffffff',
      images: [
        { public_id: 'seed/banner-10', secure_url: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=1600&q=80' },
        { public_id: 'seed/banner-11', secure_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1600&q=80' },
        { public_id: 'seed/banner-12', secure_url: 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=1600&q=80' },
      ],
    },
    footer: {
      socialLinks: { facebook: 'https://facebook.com/masheco', youtube: 'https://youtube.com/@masheco', tiktok: 'https://tiktok.com/@masheco' },
      contactInfo: { email: 'store4@masheco.com', phone: '+880 1800-000004', address: 'Sector 4, Uttara, Dhaka, Bangladesh' },
      policies: {
        aboutUs: 'ApexElectronics equips professionals with top-grade technology and precision workstation equipment.',
        privacyPolicy: 'Enterprise data compliance and privacy protection guaranteed.',
        termsAndConditions: 'All items include authentic manufacturer serial tracking and warranty.',
        returnPolicy: '7-day inspection and return policy.'
      },
      copyrightText: '© 2026 ApexElectronics Pro Store. All rights reserved. Powered by MASH ECO.'
    }
  },
  'design-05': {
    defaultSubdomain: 'store5',
    name: 'LuxeTech Boutique',
    themeId: 'design-05',
    primaryColor: '#000000',
    logo: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=250&h=250&fit=crop&q=80',
    description: 'Bespoke luxury electronics, handcrafted audiophile systems, titanium wearable devices, and exclusive flagship smart accessories with concierge delivery.',
    banner: {
      title: 'The Art of Luxury Technology',
      subtitle: 'Boutique Flagship Electronics',
      description: 'Handcrafted audio transducers, bespoke flagship smartphones, titanium wearables, and luxury smart accessories.',
      buttonText: 'Discover The Collection',
      buttonLink: '/categories',
      showAnnouncement: true,
      announcementText: 'White-glove concierge delivery with 2-year international warranty on all boutique items.',
      isSliding: true,
      announcementBgColor: '#000000',
      announcementTextColor: '#f59e0b',
      images: [
        { public_id: 'seed/banner-13', secure_url: 'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=1600&q=80' },
        { public_id: 'seed/banner-14', secure_url: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1600&q=80' },
        { public_id: 'seed/banner-15', secure_url: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=1600&q=80' },
      ],
    },
    footer: {
      socialLinks: { facebook: 'https://facebook.com/masheco', youtube: 'https://youtube.com/@masheco', tiktok: 'https://tiktok.com/@masheco' },
      contactInfo: { email: 'store5@masheco.com', phone: '+880 1800-000005', address: 'Baridhara Diplomatic Zone, Dhaka, Bangladesh' },
      policies: {
        aboutUs: 'LuxeTech brings world-class luxury electronics and bespoke smart devices to discerning connoisseurs.',
        privacyPolicy: 'Strict VIP customer data confidentiality and security.',
        termsAndConditions: 'Includes 2-year international premium concierge warranty.',
        returnPolicy: '10-day VIP white-glove return policy.'
      },
      copyrightText: '© 2026 LuxeTech Boutique Store. All rights reserved. Powered by MASH ECO.'
    }
  },
};

const resolvePreviewUrl = (subdomain: string) => {
  const isDev = config.app.env !== 'production';
  if (isDev) {
    return `http://${subdomain}.localhost:3000`;
  }
  const baseDomain = config.app.baseDomain || 'masheco.com';
  return `https://${subdomain}.${baseDomain}`;
};

/**
 * Helper to seed a single demo store with 15 categories, 30 products per category (450 products total),
 * rich banners, full policies, and dynamic preview links.
 */
async function seedSingleDemoStore(themeId: string, customSubdomain?: string) {
  const storeConfig = DEMO_STORE_CONFIGS[themeId] || DEMO_STORE_CONFIGS['design-01'];
  const subdomain = (customSubdomain || storeConfig.defaultSubdomain).toLowerCase().trim();

  // 1. Upsert Tenant with complete logo, description, and contact info
  let tenant = await Tenant.findOne({ slug: subdomain });
  if (!tenant) {
    tenant = new Tenant({
      name: storeConfig.name,
      slug: subdomain,
      domain: subdomain,
      logo: storeConfig.logo,
      description: storeConfig.description,
      contactEmail: storeConfig.footer?.contactInfo?.email,
      contactPhone: storeConfig.footer?.contactInfo?.phone,
      contactAddress: storeConfig.footer?.contactInfo?.address,
      status: 'active',
    });
    await tenant.save();
  } else {
    tenant.name = storeConfig.name;
    tenant.status = 'active';
    tenant.domain = subdomain;
    tenant.logo = storeConfig.logo;
    tenant.description = storeConfig.description;
    tenant.contactEmail = storeConfig.footer?.contactInfo?.email;
    tenant.contactPhone = storeConfig.footer?.contactInfo?.phone;
    tenant.contactAddress = storeConfig.footer?.contactInfo?.address;
    await tenant.save();
  }

  // 2. Ensure Tenant Admin User exists
  const adminEmail = `${subdomain}@masheco.demo`;
  let adminUser = await User.findOne({ email: adminEmail });
  if (!adminUser) {
    adminUser = new User({
      name: `${storeConfig.name} Manager`,
      email: adminEmail,
      password: 'demostorepassword123',
      role: 'tenant_admin',
      tenantId: tenant._id,
    });
    await adminUser.save();
  }
  if (!tenant.ownerId) {
    tenant.ownerId = adminUser._id as Types.ObjectId;
    await tenant.save();
  }

  // 3. Ensure Active 365-Day Subscription
  const oneYearLater = new Date();
  oneYearLater.setDate(oneYearLater.getDate() + 365);
  await Subscription.findOneAndUpdate(
    { tenantId: tenant._id },
    {
      tenantId: tenant._id,
      startDate: new Date(),
      endDate: oneYearLater,
      status: 'active',
      isTrial: true,
    },
    { upsert: true, returnDocument: 'after' }
  );

  // 4. Upsert Theme with complete configuration
  await Theme.findOneAndUpdate(
    { tenantId: tenant._id },
    {
      tenantId: tenant._id,
      themeId: storeConfig.themeId,
      primaryColor: storeConfig.primaryColor,
      fontFamily: 'Inter',
      language: 'en',
      currencySymbol: '৳',
      banner: storeConfig.banner,
      footer: storeConfig.footer,
      buttonColors: {
        addToCart: storeConfig.primaryColor,
        buyNow: storeConfig.primaryColor,
      },
      shippingZones: [
        { name: 'Inside Dhaka City', cost: 60, division: 'Dhaka', districts: ['Dhaka'] },
        { name: 'Outside Dhaka (All BD)', cost: 120, division: 'All', districts: [] },
      ],
      defaultShippingCost: 120,
    },
    { upsert: true, returnDocument: 'after' }
  );

  // 5. Clean existing categories & products for this tenant
  await Product.deleteMany({ tenantId: tenant._id });
  await Category.deleteMany({ tenantId: tenant._id });

  // 6. Seed exactly 15 categories
  const targetCategories = abstractCategories.slice(0, 15);
  const categoriesToInsert = targetCategories.map((c) => ({
    name: c.en,
    slug: `${c.id}-${subdomain}-${Math.floor(100 + Math.random() * 900)}`,
    description: `High performance authentic ${c.en} products with official warranties.`,
    image: img(c.img),
    status: 'ACTIVE',
    tenantId: tenant._id,
  }));

  const createdCategories = await Category.insertMany(categoriesToInsert);

  // Map category id to newly created category ObjectId
  const catIdToDocMap: Record<string, Types.ObjectId> = {};
  for (let i = 0; i < createdCategories.length; i++) {
    const rawCat = targetCategories[i];
    const doc = createdCategories[i];
    if (rawCat && doc) {
      catIdToDocMap[rawCat.id] = doc._id as Types.ObjectId;
    }
  }

  // 7. Seed exactly 30 products per category (Total: 15 * 30 = 450 products)
  const prodsByCat: Record<string, (typeof abstractProducts)[0][]> = {};
  for (const p of abstractProducts) {
    if (!prodsByCat[p.cat]) prodsByCat[p.cat] = [];
    prodsByCat[p.cat]!.push(p);
  }

  const allProductsToInsert: any[] = [];
  const modelSuffixes = ['Pro Edition', 'Ultra Max', 'Plus Series', 'Flagship', 'Studio Edition', 'Special Edition', 'Prime', 'Gen 2', 'Wireless v2', 'Elite'];

  for (const cat of targetCategories) {
    const catObjectId = catIdToDocMap[cat.id];
    let templates = prodsByCat[cat.id] || [];
    if (templates.length === 0) {
      templates = abstractProducts.slice(0, 5);
    }

    for (let j = 0; j < 30; j++) {
      const template = templates[j % templates.length]!;
      const modelNum = 1000 + j * 7 + Math.floor(Math.random() * 10);
      const suffix = modelSuffixes[j % modelSuffixes.length];
      const title = `${template.brand} ${template.en.title} (${suffix} - M${modelNum})`;
      
      const priceMultiplier = 0.9 + (j % 5) * 0.08;
      const origPrice = Math.floor(template.price * priceMultiplier);
      const discPrice = Math.floor(origPrice * 0.92);
      const saveAmt = origPrice - discPrice;

      const sku = `${subdomain.toUpperCase()}-${cat.id.slice(0, 3).toUpperCase()}-${modelNum}`;
      const slug = `${cat.id}-${subdomain}-${j + 1}-${Math.random().toString(36).substring(2, 7)}`;

      const productImg = template.img || cat.img;

      allProductsToInsert.push({
        title,
        slug,
        sku,
        shortDescription: `${template.en.desc}. Built with premium electronic components for supreme reliability.`,
        description: `<h3>${title}</h3><p>${template.en.desc}</p><p>Crafted by <strong>${template.brand}</strong> with industry-leading precision and authentic quality.</p><ul><li>Official 1-Year Comprehensive Warranty</li><li>100% Genuine Sealed Unit</li><li>Optimized energy efficiency and high durability</li><li>Includes full original in-box accessories</li></ul>`,
        images: [
          img(productImg),
          img(cat.img),
        ],
        specifications: [
          {
            group: 'General',
            entries: [
              { name: 'Brand', value: template.brand },
              { name: 'Model', value: `M${modelNum} (${suffix})` },
              { name: 'Warranty', value: '1 Year Official Brand Warranty' },
              { name: 'Condition', value: 'Brand New (Factory Sealed)' },
            ]
          },
          {
            group: 'Technical Specs',
            entries: [
              { name: 'Category', value: cat.en },
              { name: 'Connectivity', value: 'USB Type-C / Fast Wireless / Bluetooth 5.3' },
              { name: 'Power Rating', value: 'High Efficiency Fast-Charging Supported' },
              { name: 'Package Contents', value: 'Device, Power Cable, Documentation & Warranty Card' },
            ]
          }
        ],
        originalPrice: origPrice,
        discountedPrice: discPrice,
        saveAmount: saveAmt,
        badgeText: j % 3 === 0 ? 'Best Seller' : j % 4 === 0 ? 'Official' : 'Top Rated',
        features: [
          'High Performance Hardware',
          'Official Brand Authenticity Guaranteed',
          'Fast Charging Compatible',
          '7-Day Easy Replacement Policy',
        ],
        videos: vid(),
        isAuthentic: true,
        brand: template.brand,
        weight: 0.5 + (j % 5) * 0.2,
        dimensions: dim(),
        condition: 'New',
        status: 'ACTIVE',
        unit: 'piece',
        categoryId: catObjectId,
        tenantId: tenant._id,
        stock: 45 + (j % 25),
        salesCount: Math.floor(Math.random() * 80) + 10,
      });
    }
  }

  await Product.insertMany(allProductsToInsert, { ordered: false });

  // 8. Update GlobalSetting theme preview link
  const previewUrl = resolvePreviewUrl(subdomain);
  let globalSetting = await GlobalSetting.findOne();
  if (!globalSetting) {
    globalSetting = new GlobalSetting();
  }
  if (!globalSetting.themePreviews) {
    globalSetting.themePreviews = {};
  }
  globalSetting.themePreviews[themeId] = previewUrl;
  await globalSetting.save();

  return {
    themeId,
    subdomain,
    storeName: storeConfig.name,
    tenantId: tenant._id,
    categoriesCount: createdCategories.length,
    productsCount: allProductsToInsert.length,
    previewUrl,
  };
}

const generateDemoStore = asyncHandler(async (req: Request, res: Response) => {
  const { themeId, subdomain } = req.body;
  if (!themeId) {
    return ApiResponse.sendError(res, 400, "Theme ID is required (e.g. 'design-01')");
  }

  const result = await seedSingleDemoStore(themeId, subdomain);
  ApiResponse.sendSuccess(res, 201, `Demo store for ${themeId} generated successfully!`, result);
});

const generateAllDemoStores = asyncHandler(async (req: Request, res: Response) => {
  const themes = ['design-01', 'design-02', 'design-03', 'design-04', 'design-05'];
  
  // Seed all 5 demo stores concurrently for ultra-fast response
  const results = await Promise.all(
    themes.map(themeId => seedSingleDemoStore(themeId))
  );

  const globalSetting = await GlobalSetting.findOne();

  ApiResponse.sendSuccess(res, 201, "All 5 demo stores seeded and preview links configured successfully!", {
    stores: results,
    themePreviews: globalSetting?.themePreviews || {},
  });
});

async function deleteSingleDemoStore(themeId: string, customSubdomain?: string) {
  const storeConfig = DEMO_STORE_CONFIGS[themeId] || DEMO_STORE_CONFIGS['design-01'];
  const subdomain = (customSubdomain || storeConfig.defaultSubdomain).toLowerCase().trim();

  let productsDeleted = 0;
  let categoriesDeleted = 0;

  const tenant = await Tenant.findOne({ slug: subdomain });
  if (tenant) {
    const prodRes = await Product.deleteMany({ tenantId: tenant._id });
    const catRes = await Category.deleteMany({ tenantId: tenant._id });
    await Theme.deleteMany({ tenantId: tenant._id });
    await Subscription.deleteMany({ tenantId: tenant._id });
    await User.deleteMany({
      $or: [{ tenantId: tenant._id }, { email: `${subdomain}@masheco.demo` }]
    });
    await Tenant.findByIdAndDelete(tenant._id);

    productsDeleted = prodRes.deletedCount;
    categoriesDeleted = catRes.deletedCount;
  }

  // Clear GlobalSetting theme preview link
  const globalSetting = await GlobalSetting.findOne();
  if (globalSetting && globalSetting.themePreviews) {
    globalSetting.themePreviews[themeId] = '';
    await globalSetting.save();
  }

  return {
    themeId,
    subdomain,
    deleted: Boolean(tenant),
    productsDeleted,
    categoriesDeleted,
  };
}

const deleteDemoStore = asyncHandler(async (req: Request, res: Response) => {
  const { themeId, subdomain } = req.body;
  if (!themeId) {
    return ApiResponse.sendError(res, 400, "Theme ID is required (e.g. 'design-01')");
  }

  const result = await deleteSingleDemoStore(themeId, subdomain);
  ApiResponse.sendSuccess(res, 200, `Demo store for ${themeId} deleted successfully!`, result);
});

const deleteAllDemoStores = asyncHandler(async (req: Request, res: Response) => {
  const themes = ['design-01', 'design-02', 'design-03', 'design-04', 'design-05'];
  const results: any[] = [];

  for (const themeId of themes) {
    const resStore = await deleteSingleDemoStore(themeId);
    results.push(resStore);
  }

  const globalSetting = await GlobalSetting.findOne();

  ApiResponse.sendSuccess(res, 200, "All 5 demo stores and preview links cleared successfully!", {
    stores: results,
    themePreviews: globalSetting?.themePreviews || {},
  });
});

const clearSeedData = asyncHandler(async (req: Request, res: Response) => {
  const tenantId: Types.ObjectId = (req as any).user.tenantId;

  const deletedProducts = await Product.deleteMany({ tenantId });
  const deletedCategories = await Category.deleteMany({ tenantId });

  ApiResponse.sendSuccess(res, 200, "All store data cleared.", {
    productsDeleted: deletedProducts.deletedCount,
    categoriesDeleted: deletedCategories.deletedCount,
  });
});

export const SeedController = {
  seedDemoData,
  clearSeedData,
  generateDemoStore,
  generateAllDemoStores,
  deleteDemoStore,
  deleteAllDemoStores,
};
