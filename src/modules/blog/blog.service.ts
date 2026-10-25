import { IBlog, IBlogFilterOptions } from "./blog.interface";
import { Blog } from "./blog.model";
import CustomError from "../../helpers/CustomError";
import { paginationHelper } from "../../helpers/paginationHelper";

const notifyBlogUpdate = () => {
  try {
    const io = require("../../socket").getIO();
    io.emit("refresh_blogs");
  } catch (error) {}
};

const createBlog = async (payload: Partial<IBlog>): Promise<IBlog> => {
  if (!payload.title) {
    throw new CustomError(400, "Title is required");
  }

  // Frontend theke kono slug nibe na — model pre middleware auto generate korbe
  const { slug: _frontendSlug, ...blogData } = payload;

  const createPayload: Record<string, any> = {
    ...blogData,
  };

  if (payload.isPublished !== false) {
    createPayload.publishedAt = payload.publishedAt || new Date();
  }

  const blog = await Blog.create(createPayload);

  notifyBlogUpdate();
  return blog;
};

const getAllBlogs = async (options: IBlogFilterOptions) => {
  const { page, limit, searchTerm, category, status } = options;
  const {
    page: currentPage,
    limit: perPage,
    skip,
  } = paginationHelper(page, limit);

  const filter: Record<string, any> = {};

  if (searchTerm && searchTerm.trim() !== "") {
    const regex = new RegExp(searchTerm.trim(), "i");
    filter.$or = [
      { title: regex },
      { excerpt: regex },
      { category: regex },
      { author: regex },
    ];
  }

  if (category && category !== "all") {
    filter.category = category;
  }

  if (status === "published") {
    filter.isPublished = true;
  } else if (status === "draft") {
    filter.isPublished = false;
  }

  const total = await Blog.countDocuments(filter);
  const data = await Blog.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(perPage);

  return {
    data,
    meta: {
      page: currentPage,
      limit: perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    },
  };
};

const getPublicBlogs = async (options: IBlogFilterOptions) => {
  const { page, limit, searchTerm, category } = options;
  const {
    page: currentPage,
    limit: perPage,
    skip,
  } = paginationHelper(page, limit);

  const filter: Record<string, any> = {
    isPublished: true,
  };

  if (searchTerm && searchTerm.trim() !== "") {
    const regex = new RegExp(searchTerm.trim(), "i");
    filter.$or = [
      { title: regex },
      { excerpt: regex },
      { category: regex },
      { tags: regex },
    ];
  }

  if (category && category.toLowerCase() !== "all") {
    filter.category = new RegExp(`^${category.trim()}$`, "i");
  }

  const total = await Blog.countDocuments(filter);
  const data = await Blog.find(filter)
    .select(
      "title slug excerpt category tags thumbnail author authorRole readTime views publishedAt featured createdAt",
    )
    .sort({ featured: -1, publishedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(perPage);

  return {
    data,
    meta: {
      page: currentPage,
      limit: perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    },
  };
};

const getBlogBySlug = async (slug: string): Promise<IBlog> => {
  const blog = await Blog.findOneAndUpdate(
    { slug, isPublished: true },
    { $inc: { views: 1 } },
    { new: true },
  );

  if (!blog) {
    throw new CustomError(404, "Article not found");
  }

  return blog;
};

const updateBlog = async (
  id: string,
  payload: Partial<IBlog>,
): Promise<IBlog | null> => {
  const existing = await Blog.findById(id);
  if (!existing) {
    throw new CustomError(404, "Article not found");
  }

  // Frontend theke kono slug nibe na — model pre('findOneAndUpdate') middleware auto generate korbe
  const { slug: _frontendSlug, ...updateData } = payload;

  if (updateData.isPublished === true && !existing.publishedAt) {
    updateData.publishedAt = new Date();
  }

  const updated = await Blog.findByIdAndUpdate(id, updateData, { new: true });
  notifyBlogUpdate();
  return updated;
};

const deleteBlog = async (id: string): Promise<IBlog | null> => {
  const deleted = await Blog.findByIdAndDelete(id);
  if (!deleted) {
    throw new CustomError(404, "Article not found");
  }
  notifyBlogUpdate();
  return deleted;
};

/**
 * Seed initial blog articles if collection is empty or forced
 */
const seedInitialBlogs = async (force: boolean = false): Promise<void> => {
  try {
    const count = await Blog.countDocuments();
    if (count > 0 && !force) return;

    if (force) {
      await Blog.deleteMany({});
      console.log("🗑️ Cleared existing blogs for re-seeding.");
    }

    const initialBlogs: Partial<IBlog>[] = [
      {
        title:
          "কুরিয়ার অটোমেশন: ম্যানুয়াল এন্ট্রি ছাড়া দ্রুত পার্সেল ডেলিভারি",
        slug: "courier-automation-fast-delivery-bangladesh",
        excerpt:
          "পাঠাও, রেডএক্স ও স্টিডফাস্ট কুরিয়ারের সাথে ওয়ান-ক্লিক অটোমেশন। কাস্টমার অ্যাড্রেস স্বয়ংক্রিয়ভাবে সাবমিট ও ট্র্যাক করুন।",
        content: `## বাংলাদেশে ই-কমার্স ডেলিভারির আধুনিক সমাধান

অনলাইন ব্যবসায় সবচেয়ে বেশি সময় ও শ্রম অপচয় হয় পার্সেল হ্যান্ডলিং এবং কুরিয়ার এন্ট্রিতে। প্রতিটি অর্ডারের নাম, ঠিকানা এবং ফোন নাম্বার কপি-পেস্ট করে কুরিয়ার ওয়েবসাইটে বসাতে গিয়ে প্রতিদিন ঘণ্টার পর ঘণ্টা নষ্ট হয়।

### কুরিয়ার অটোমেশনের সুবিধা

**MASH ECO** নিয়ে এসেছে সরাসরি শীর্ষস্থানীয় কুরিয়ার সার্ভিসের সাথে গভীর ইন্টিগ্রেশন:
- **পাঠাও কুরিয়ার (Pathao Courier):** ঢাকা ও ঢাকার বাইরে দ্রুত ডেলিভারি ও রিয়েলটাইম পার্সেল ট্র্যাকিং।
- **স্টিডফাস্ট কুরিয়ার (Steadfast Courier):** ৬৪ জেলায় ক্যাশ অন ডেলিভারি এবং দ্রুত পেমেন্ট ডিসবার্সমেন্ট।
- **রেডএক্স (RedX Logistics):** ডোরস্টেপ পিকআপ এবং এন্ড-টু-এন্ড অটোমেটেড রিটার্ন ট্র্যাকিং।

### এক ক্লিকে পার্সেল বুকিং

অর্ডার আসার সাথে সাথে ড্যাশবোর্ড থেকে শুধু **"Send to Courier"** চাপলেই সম্পূর্ণ বিবরণ স্বয়ংক্রিয়ভাবে কুরিয়ারে চলে যাবে এবং সরাসরি ইনভয়েস ও বারকোড লেবেল প্রিন্ট করা যাবে।`,
        category: "Product Update",
        tags: ["কুরিয়ার", "অটোমেশন", "লজিস্টিকস"],
        thumbnail: "",
        author: "MASH ECO Team",
        authorRole: "Product & Engineering",
        readTime: "৪ মিনিট",
        isPublished: true,
        featured: true,
        views: 342,
        publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        title: "অর্ডারের ড্রপ-আউট কমিয়ে বিক্রয় দ্বিগুণ করার সহজ উপায়",
        slug: "how-to-reduce-abandoned-checkout-leads-bangla",
        excerpt:
          "চেকআউট পেজে কাস্টমার এসে কেন ড্রপ আউট হয়? লিড ক্যাপচার করে হোয়াটসঅ্যাপে ফলো-আপ করে হারিয়ে যাওয়া সেল ফিরিয়ে আনুন।",
        content: `## এব্যান্ডনড চেকআউট থেকে সেলস রিকভারি

বাংলাদেশে প্রায় ৬৫% এর বেশি ক্রেতা কার্টে প্রোডাক্ট যোগ করে ঠিকানা লেখা শুরু করার পরও অর্ডার কনফার্ম না করেই পেজ বন্ধ করে দেন। এই ক্রেতারা কিন্তু আগ্রহ নিয়েই এসেছিলেন।

### কেন কাস্টমার অর্ডার অসম্পূর্ণ রাখে?

- শেষ ধাপে ডেলিভারি চার্জ দেখে দ্বিধা তৈরি হওয়া।
- ক্যাশ অন ডেলিভারিতে প্রোডাক্ট আসল হবে কিনা তা নিয়ে সংশয়।
- নেটওয়ার্কের সমস্যা বা অন্য কোনো কাজে মনোযোগ সরে যাওয়া।

### MASH ECO লিড ক্যাপচার সিস্টেমের কৌশল

কাস্টমার চেকআউট ফর্মে নাম ও মোবাইল নম্বর টাইপ করার সাথে সাথেই ব্যাকএন্ডে লিড সেভ হয়ে যায়।
- **৩০ মিনিটের ভেতর হোয়াটসঅ্যাপ ফলো-আপ:** কাস্টমারকে বন্ধুত্বপূর্ণ একটি মেসেজ দিলে ২৫% থেকে ৩০% অর্ডার সাথে সাথে কনফার্ম হয়।
- **ফ্রি ডেলিভারি অফার:** নির্দিষ্ট পরিমাণের অর্ডারে ফ্রি ডেলিভারি অফার ক্রেতার দ্বিধা দূর করে।`,
        category: "E-commerce Tips",
        tags: ["চেকআউট", "সেলস", "টিপস"],
        thumbnail: "",
        author: "সাব্বির আহমেদ",
        authorRole: "Growth Strategist",
        readTime: "৫ মিনিট",
        isPublished: true,
        featured: true,
        views: 489,
        publishedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      },
      {
        title: "অনলাইন স্টোর দ্রুত স্কেল করার ৫টি কার্যকর কৌশল",
        slug: "top-5-strategies-to-scale-online-store-bangla",
        excerpt:
          "ফেসবুক পেজ নির্ভরতা কাটিয়ে নিজের ব্র্যান্ডেড ডোমেইন, মেটা পিক্সেল ট্র্যাকিং এবং রিটার্ন পার্সেল কমানোর সেরা কৌশল।",
        content: `## ফেসবুকে মেসেজ নেওয়া থেকে ব্র্যান্ডেড ই-কমার্সে রূপান্তর

শুধু ফেসবুক পেজে মেসেজের মাধ্যমে ব্যবসা পরিচালনা করলে বেশি ভলিউম হ্যান্ডেল করা অসম্ভব হয়ে পড়ে। শত শত মেসেজের উত্তর দেওয়া, স্টক হিসাব রাখা এবং ভুল অর্ডার পাঠানো থেকে বাঁচতে নিজস্ব অনলাইন স্টোর অপরিহার্য।

### ৫টি মূল স্তম্ভ:
1. **নিজস্ব ব্র্যান্ডেড ডোমেইন:** yourstore.com ক্রেতার মনে বিশ্বাস ও সম্মান বৃদ্ধি করে।
2. **সার্ভার-সাইড মেটা পিক্সেল (CAPI):** iOS আপডেটের পরও নিখুঁত পারচেজ ট্র্যাকিং নিশ্চিত করে অ্যাড অপ্টিমাইজ করা।
3. **ফ্রড স্কোরিং ও ভুয়া অর্ডার রোধ:** যেসব কাস্টমার অতীতে একাধিক দোকানে পার্সেল ফেরত দিয়েছে তাদের শুরুতেই শনাক্ত করা।
4. **স্বয়ংক্রিয় স্টক ম্যানেজমেন্ট:** শেষ হয়ে যাওয়া প্রোডাক্ট যাতে কাস্টমার অর্ডার না করতে পারে।
5. **মাল্টিপল পেমেন্ট মেথড:** ক্যাশ অন ডেলিভারি, বিকাশ এবং নগদ ম্যানুয়াল ভেরিফিকেশন।`,
        category: "Business Growth",
        tags: ["গ্রোথ", "স্ট্র্যাটেজি", "বিজনেস"],
        thumbnail: "",
        author: "মোহাম্মদ মহসিন",
        authorRole: "Business Advisory",
        readTime: "৬ মিনিট",
        isPublished: true,
        featured: false,
        views: 512,
        publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
      {
        title: "রিটার্ন পার্সেল (RTO) ও ডেলিভারি লস কমানোর গাইড",
        slug: "complete-guide-to-setting-up-cod-and-fraud-prevention-bangla",
        excerpt:
          "ক্যাশ অন ডেলিভারিতে ফেক অর্ডার শনাক্ত করা ও কাস্টমার ফ্রড স্কোরিংয়ের মাধ্যমে ডেলিভারি চার্জের ক্ষতি বাঁচান।",
        content: `## ক্যাশ অন ডেলিভারিতে লোকসান ঠেকানোর নিয়ম

বাংলাদেশে ই-কমার্সে ৮০% এর বেশি অর্ডার ক্যাশ অন ডেলিভারিতে হয়। কিন্তু কাস্টমার যদি পার্সেল রিসিভ না করে, তবে আপ-ডাউন উভয় ডেলিভারি চার্জ মার্চেন্টকেই বহন করতে হয়।

### ক্ষতি কমানোর কার্যকর উপায়:
- **১১ ডিজিটের সঠিক ফোন নম্বর যাচাই:** ইনভ্যালিড নম্বর দিয়ে অর্ডার করা বন্ধ করা।
- **অর্ডার কনফার্মেশন কল বা এসএমএস:** অর্ডারের সাথে সাথেই স্বয়ংক্রিয় এসএমএস বা দ্রুত কনফার্মেশন কল ৩০% রিটার্ন কমায়।
- **হাই-ভ্যালু অর্ডারে ডেলিভারি চার্জ অগ্রিম:** ৩,০০০ টাকার বেশি অর্ডারে ন্যূনতম ডেলিভারি চার্জ বিকাশে অগ্রিম গ্রহণ করা।`,
        category: "Guides",
        tags: ["ক্যাশ অন ডেলিভারি", "ফ্রড প্রতিরোধ", "গাইড"],
        thumbnail: "",
        author: "MASH ECO Team",
        authorRole: "Security & Operations",
        readTime: "৪ মিনিট",
        isPublished: true,
        featured: false,
        views: 298,
        publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
      {
        title: "ফেসবুক পেজ থেকে প্রফেশনাল অনলাইন শপ চালুর নিয়ম",
        slug: "facebook-page-to-branded-ecommerce-store",
        excerpt:
          "কোনো কোডিং ছাড়া মাত্র ৫ মিনিটে লাইভ করুন আপনার ই-কমার্স ওয়েবসাইট। কাস্টম ডোমেইন ও প্রিমিয়াম থিম রেডি।",
        content: `## কীভাবে ৫ মিনিটে স্টোর চালু করবেন

MASH ECO প্ল্যাটফর্মে কোডিংয়ের কোনো ঝামেলা নেই। অ্যাকাউন্ট তৈরি করে লোগো, প্রোডাক্ট এবং দাম আপলোড করলেই সম্পূর্ণ স্টোর প্রস্তুত।

### প্রধান ফিচারসমূহ:
- **৫টি আধুনিক ও কনভার্সন অপ্টিমাইজড থিম**
- **ফ্রি সাবডোমেন অথবা নিজস্ব ডোমেইন সংযোগ**
- **মোবাইল ফ্রেন্ডলি দ্রুত লোডিং চেকআউট**`,
        category: "Tutorial",
        tags: ["টিউটোরিয়াল", "স্টোর সেটআপ"],
        thumbnail: "",
        author: "MASH ECO Team",
        authorRole: "Product & Support",
        readTime: "৩ মিনিট",
        isPublished: true,
        featured: false,
        views: 180,
        publishedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
      },
      {
        title: "বিকাশ ও নগদ মার্চেন্ট পেমেন্ট অটোমেশন",
        slug: "bkash-nagad-manual-payment-verification-automation",
        excerpt:
          "ম্যানুয়াল স্ক্রিনশট চেক করার ঝামেলা শেষ। ট্রানজেকশন আইডি (TrxID) দিয়ে নিমিষেই অর্ডার কনফার্মেশন।",
        content: `## পেমেন্ট ভেরিফিকেশনের আধুনিক রূপ

অনেক সময় কাস্টমার ফেক পেমেন্ট স্ক্রিনশট পাঠিয়ে অর্ডার দাবি করে। MASH ECO এর TrxID ভেরিফিকেশন সিস্টেম মার্চেন্টকে রিয়েলটাইমে পেমেন্ট স্ট্যাটাস যাচাইয়ের সুবিধা দেয়।

### TrxID যাচাইয়ের সুবিধা:
- **অটোমেটেড স্ট্যাটাস আপডেট:** ট্রানজেকশন আইডি ম্যাচ করার সাথে সাথে অর্ডার স্বয়ংক্রিয়ভাবে পেইড হিসেবে চিহ্নিত হয়।
- **ডুপ্লিকেট পেমেন্ট প্রতিরোধ:** একটি TrxID একাধিকবার ব্যবহারের কোনো সুযোগ থাকে না।`,
        category: "Case Study",
        tags: ["পেমেন্ট", "বিকাশ", "নগদ"],
        thumbnail: "",
        author: "সাব্বির আহমেদ",
        authorRole: "FinTech Specialist",
        readTime: "৪ মিনিট",
        isPublished: true,
        featured: false,
        views: 220,
        publishedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      },
    ];

    await Blog.insertMany(initialBlogs);
    notifyBlogUpdate();
    console.log("✅ Bangla initial blog posts seeded successfully.");
  } catch (error) {
    console.error("Failed to seed initial blogs:", error);
  }
};

export const BlogService = {
  createBlog,
  getAllBlogs,
  getPublicBlogs,
  getBlogBySlug,
  updateBlog,
  deleteBlog,
  seedInitialBlogs,
};
