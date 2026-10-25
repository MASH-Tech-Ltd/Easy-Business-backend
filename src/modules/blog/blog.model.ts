import { Schema, model } from 'mongoose';
import slugify from 'slugify';
import { IBlog } from './blog.interface';

/**
 * Clean slug generator utilizing npm slugify with Unicode / Bangla support
 */
export const createSlug = (title: string): string => {
  if (!title) return `post-${Date.now().toString(36)}`;

  // Use npm slugify with relaxed options
  let s = slugify(title, {
    lower: true,
    trim: true,
    remove: /[*+~.()'"!:@,;?<>/{}\\|^[\]]/g,
  });

  // If slugify stripped non-Latin characters (e.g. Bangla or other Unicode scripts)
  if (!s || s.trim() === '' || /^[-_]+$/.test(s)) {
    s = title
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  return s || `post-${Date.now().toString(36)}`;
};

const blogSchema = new Schema<IBlog>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, trim: true, lowercase: true },
    excerpt: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    category: { type: String, required: true, trim: true, default: 'General' },
    tags: [{ type: String, trim: true }],
    thumbnail: { type: String, default: '' },
    author: { type: String, default: 'MASH ECO Team', trim: true },
    authorRole: { type: String, default: 'Editor', trim: true },
    readTime: { type: String, default: '4 min read', trim: true },
    isPublished: { type: Boolean, default: true },
    publishedAt: { type: Date, default: Date.now },
    views: { type: Number, default: 0 },
    featured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Pre-validate middleware: auto-generate unique slug on create or title change
blogSchema.pre('validate', async function () {
  if (this.isModified('title') || !this.slug) {
    const baseSlug = createSlug(this.title);
    let candidateSlug = baseSlug;
    let counter = 1;

    const BlogModel = this.constructor as any;
    while (true) {
      const exists = await BlogModel.findOne({
        slug: candidateSlug,
        _id: { $ne: this._id },
      });
      if (!exists) break;
      candidateSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = candidateSlug;
  }
});

// Pre-findOneAndUpdate middleware: auto-generate unique slug on update when title changes, ignore manual slug from frontend
blogSchema.pre('findOneAndUpdate', async function () {
  const update = this.getUpdate() as any;
  if (!update) return;

  // Never accept manual slug from frontend
  if (update.slug) delete update.slug;
  if (update.$set?.slug) delete update.$set.slug;

  const newTitle = update.title || update.$set?.title;
  if (newTitle) {
    const baseSlug = createSlug(newTitle);
    let candidateSlug = baseSlug;
    let counter = 1;

    const currentDoc = await this.model.findOne(this.getQuery());
    const existingId = currentDoc?._id;

    while (true) {
      const exists = await this.model.findOne({
        slug: candidateSlug,
        _id: { $ne: existingId },
      });
      if (!exists) break;
      candidateSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    if (update.$set) {
      update.$set.slug = candidateSlug;
    } else {
      update.slug = candidateSlug;
    }
  }
});

blogSchema.index({ isPublished: 1, createdAt: -1 });
blogSchema.index({ category: 1, isPublished: 1 });
blogSchema.index({ featured: 1, isPublished: 1 });
blogSchema.index({ title: 'text', excerpt: 'text', content: 'text' });

export const Blog = model<IBlog>('Blog', blogSchema);
