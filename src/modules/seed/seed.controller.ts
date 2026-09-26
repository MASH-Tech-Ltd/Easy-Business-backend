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
