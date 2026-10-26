import { Theme } from './theme.model';
import { ITheme } from './theme.model';
import { Tenant } from '../tenant/tenant.model';

export const generateDefaultPolicies = (
  storeName: string,
  phone = '',
  email = '',
  address = ''
) => ({
  aboutUs: `স্বাগতম ${storeName}-এ! আমরা আমাদের সম্মানিত গ্রাহকদের কাছে সর্বোচ্চ মানের পণ্য এবং নির্ভরযোগ্য অনলাইন শপিং অভিজ্ঞতা পৌঁছে দিতে প্রতিশ্রুতিবদ্ধ।\n\nআমাদের লক্ষ্য হলো গ্রাহকের আস্থা ও সন্তুষ্টি অর্জন। আমরা প্রতিটি পণ্যের গুণগত মান সতর্কতার সাথে যাচাই করে সরাসরি আপনার দোরগোড়ায় পৌঁছে দিই। দ্রুত ও নিরাপদ ডেলিভারি, সহজ রিটার্ন পলিসি এবং সার্বক্ষণিক গ্রাহক সেবার মাধ্যমে আমরা দেশের অন্যতম বিশ্বস্ত অনলাইন প্ল্যাটফর্ম।\n\nযোগাযোগের ঠিকানা:\nপ্রতিষ্ঠান: ${storeName}\n${phone ? `মোবাইল: ${phone}\n` : ''}${email ? `ইমেইল: ${email}\n` : ''}${address ? `ঠিকানা: ${address}\n` : ''}`,
  privacyPolicy: `${storeName} আপনার ব্যক্তিগত তথ্যের গোপনীয়তা ও সুরক্ষাকে সর্বোচ্চ অগ্রাধিকার দেয়।\n\n১. তথ্য সংগ্রহ: অর্ডার প্রক্রিয়া সম্পন্ন করতে এবং সঠিক ঠিকানায় পণ্য পৌঁছে দিতে আমরা আপনার নাম, মোবাইল নম্বর এবং ঠিকানা সংগ্রহ করি।\n\n২. তথ্যের নিরাপত্তা: আমরা কখনোই আপনার ব্যক্তিগত তথ্য কোনো তৃতীয় পক্ষের কাছে বিক্রি, ভাড়া বা শেয়ার করি না।\n\n৩. পেমেন্ট নিরাপত্তা: অনলাইন লেনদেনের ক্ষেত্রে অনুমোদিত নিরাপদ পেমেন্ট গেটওয়ে ব্যবহার করা হয়। আপনার কোনো কার্ড বা ব্যাংক অ্যাকাউন্টের পিন/পাসওয়ার্ড আমাদের কাছে সংরক্ষিত হয় না।`,
  termsAndConditions: `${storeName} ওয়েবসাইট ব্যবহার বা এখান থেকে পণ্য ক্রয়ের পূর্বে অনুগ্রহ করে এই শর্তাবলী মনোযোগ দিয়ে পড়ুন।\n\n১. অর্ডার প্রক্রিয়া: ওয়েবসাইটে অর্ডার সম্পন্ন করার পর আমাদের প্রতিনিধি আপনার সাথে ফোন কলের মাধ্যমে অর্ডারটি কনফার্ম করতে পারে। স্টকে অপ্রতুলতা থাকলে অর্ডার বাতিল করার অধিকার ${storeName} সংরক্ষণ করে।\n\n২. মূল্য ও পেমেন্ট: ওয়েবসাইটে প্রদর্শিত সকল পণ্যের মূল্য বাংলাদেশি টাকা (BDT)-তে নির্ধারিত। পণ্য গ্রহণের সময় ক্যাশ অন ডেলিভারি অথবা অনুমোদিত মাধ্যমে মূল্য পরিশোধ করতে হবে।\n\n৩. ডেলিভারি সময়সীমা: ঢাকার ভিতরে ২৪–৪৮ ঘণ্টা এবং ঢাকার বাইরে ২–৪ কার্যদিবসের মধ্যে ডেলিভারি প্রদান করা হয়।`,
  returnPolicy: `${storeName}-এ আপনার সন্তুষ্টিই আমাদের প্রথম অগ্রাধিকার। কোনো কারণে পণ্য নিয়ে সন্তুষ্ট না হলে বা ত্রুটি থাকলে আমরা সহজ রিটার্ন ও এক্সচেঞ্জ সুবিধা প্রদান করি।\n\n১. রিটার্নের শর্তাবলী: পণ্য গ্রহণের পর ৭ (সাত) দিনের মধ্যে রিটার্ন বা পরিবর্তনের জন্য যোগাযোগ করতে হবে। পণ্যটি অব্যবহৃত অবস্থায় আসল প্যাকেজিং ও ট্যাগ সহ ফেরত দিতে হবে।\n\n২. রিফান্ড নীতি: রিটার্নকৃত পণ্য পাওয়ার পর ৩ থেকে ৭ কার্যদিবসের মধ্যে বিকাশ, নগদ বা ব্যাংকের মাধ্যমে রিফান্ড কার্যকর করা হবে।\n\nযোগাযোগ: ${phone || email || storeName}`,
});

const updateTheme = async (tenantId: string, payload: Partial<ITheme>) => {
  const result = await Theme.findOneAndUpdate(
    { tenantId },
    { ...payload },
    { returnDocument: 'after', upsert: true }
  );
  return result;
};

const getTheme = async (tenantId: string) => {
  let result = await Theme.findOne({ tenantId });
  if (!result) {
    const tenant = await Tenant.findById(tenantId).select('name contactPhone contactEmail contactAddress').lean();
    const storeName = tenant?.name || 'আমাদের স্টোর';
    const phone = tenant?.contactPhone || '';
    const email = tenant?.contactEmail || '';
    const address = tenant?.contactAddress || '';

    const initialPolicies = generateDefaultPolicies(storeName, phone, email, address);

    result = await Theme.create({
      tenantId,
      footer: {
        contactInfo: { email, phone, address },
        policies: initialPolicies,
      },
    });
  }
  return result;
};

export const ThemeService = {
  updateTheme,
  getTheme,
  generateDefaultPolicies,
};
