import { Request, Response } from "express";
import { Category } from "../category/category.model";
import { Product } from "../product/product.model";
import { Types } from "mongoose";
import ApiResponse from "../../utils/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";

const img = (url: string) => ({ public_id: "seed/placeholder", secure_url: url });
const vid = () => ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"];
const dim = () => ({ length: 15, width: 10, height: 5 });

import { abstractCategories, abstractProducts } from "./seed.data";

function generateSeedData(lang: 'en' | 'bn') {
  const categories = abstractCategories.map((c) => ({
    _tempId: c.id,
    name: c[lang],
    description: lang === 'en' ? `Top quality ${c.en} products.` : `সেরা মানের ${c.bn} পণ্য।`,
    image: img(c.img),
    status: 'ACTIVE'
  }));

  const productsFn = (catMap: Record<string, Types.ObjectId>, tenantId: Types.ObjectId) => {
    return abstractProducts.map((p, i) => {
      const data = p[lang];
      return {
        title: data.title,
        shortDescription: data.desc,
        description: `${data.title} - ${data.desc}. Premium product by ${p.brand}.`,
        images: [img(p.img)], videos: vid(),
        originalPrice: p.price, discountedPrice: Math.floor(p.price * 0.9), saveAmount: Math.ceil(p.price * 0.1),
        badgeText: i % 5 === 0 ? (lang === 'en' ? 'Best Seller' : 'বেস্ট সেলার') : (lang === 'en' ? 'New Arrival' : 'নতুন আগমন'),
        brand: p.brand, stock: 50, salesCount: 120, isAuthentic: true,
        features: lang === 'en' ? ["Premium Quality", "Authentic Brand", "1 Year Warranty"] : ["প্রিমিয়াম কোয়ালিটি", "আসল ব্র্যান্ড", "১ বছরের ওয়ারেন্টি"],
        specifications: [{ group: lang === 'en' ? 'General' : 'সাধারণ', entries: [{ name: lang === 'en' ? 'Brand' : 'ব্র্যান্ড', value: p.brand }] }],
        weight: 0.5, dimensions: dim(), condition: "New", status: "ACTIVE", sku: `SKU-${p.cat.toUpperCase()}-${i}`, unit: lang === 'en' ? 'piece' : 'পিস',
        categoryId: catMap[p.cat], tenantId,
      };
    });
  };

  return { categories, productsFn };
}

const SEED_DATA = {
  en: generateSeedData('en'),
  bn: generateSeedData('bn')
};

const seedDemoData = asyncHandler(async (req: Request, res: Response) => {
  const tenantId: Types.ObjectId = (req as any).user.tenantId;
  const lang = (req.query.lang as 'en' | 'bn') || 'en';
  const type = (req.query.type as string) || 'all';
  
  const dataset = SEED_DATA[lang] || SEED_DATA.en;

  const typeMap: Record<string, string[]> = {
    electronics: [
      "smartphones", "laptops", "audio", "cameras", "tvs", "gaming", "smartwatches", 
      "accessories", "drones", "tablets", "networking", "components", "monitors", "printers", "smarthome"
    ],
    fashion: [
      "mens_wear", "womens_wear", "kids_wear", "shoes", "watches", "bags", "jewelry", 
      "sunglasses", "beauty", "fragrances", "activewear", "swimwear", "winterwear", "intimates", "fashion_acc"
    ],
    lifestyle: [
      "furniture", "home_decor", "sports", "groceries", "books", "stationery", "kitchenware", 
      "gardening", "pet_supplies", "automotive", "toys", "fitness", "health", "tools", "bedding"
    ],
  };

  const allowedCategories = type === 'all' || !typeMap[type] ? null : typeMap[type];

  const existingCats = await Category.countDocuments({ tenantId });
  const existingProds = await Product.countDocuments({ tenantId });

  if (existingCats > 0 || existingProds > 0) {
    return ApiResponse.sendError(
      res,
      409,
      `Store already has data (${existingCats} categories, ${existingProds} products). Use the reset endpoint to clear data before re-seeding.`
    );
  }

  const filteredCategories = dataset.categories
    .filter(c => !allowedCategories || allowedCategories.includes(c._tempId));

  const categoriesToInsert = filteredCategories
    .map((cat) => ({ name: cat.name, description: cat.description, image: cat.image, status: cat.status, tenantId }));

  const categoryDocs = await Category.insertMany(categoriesToInsert);

  const categoryMap: Record<string, Types.ObjectId> = {};
  for (let i = 0; i < categoryDocs.length; i++) {
    const tempId = filteredCategories[i]?._tempId;
    const doc = categoryDocs[i];
    if (tempId && doc) {
      categoryMap[tempId] = doc._id as Types.ObjectId;
    }
  }

  const allProductsData = dataset.productsFn(categoryMap, tenantId);
  const productsToInsert = allProductsData.filter(p => !!p.categoryId);
  const productDocs = await Product.insertMany(productsToInsert);

  ApiResponse.sendSuccess(res, 201, "Demo data seeded successfully!", {
    categoriesCreated: categoryDocs.length,
    productsCreated: productDocs.length,
    message: "Your store now has demo categories and products. Visit your storefront to see them live!",
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
};
