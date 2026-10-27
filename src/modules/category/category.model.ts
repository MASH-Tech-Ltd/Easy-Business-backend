import { Schema, model } from 'mongoose';
import { ICategory } from './category.interface';
import slugify from 'slugify';

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true },
    slug: { type: String },
    description: { type: String },
    image: {
      public_id: { type: String },
      secure_url: { type: String }
    },
    status: { type: String, enum: ['ACTIVE', 'DRAFT', 'INACTIVE'], default: 'ACTIVE' },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  },
  {
    timestamps: true,
  }
);

function generateSlug(name: string): string {
  // First try ascii slugify (for English and Latin text)
  const asciiSlug = slugify(name, { lower: true, strict: true, trim: true });
  if (asciiSlug) return asciiSlug;

  // Support Unicode letters \p{L}, combining marks \p{M} (like Bengali vowels), and numbers \p{N}
  const unicodeSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '')
    .replace(/[\s-]+/g, '-');

  return unicodeSlug || 'category-' + Math.random().toString(36).substring(2, 8);
}

// Ensure slug is generated before validation if not already present
categorySchema.pre('validate', function () {
  if (this.name && !this.slug) {
    this.slug = generateSlug(this.name);
  }
});

// Handles BOTH initial slug generation AND slug re-generation when name is updated
categorySchema.pre('save', function () {
  if (this.name && (this.isNew || this.isModified('name'))) {
    this.slug = generateSlug(this.name);
  }
});


// so the 'findOneAndUpdate' hook below already covers it automatically.
function slugMiddleware(this: any) {
  const update: any = this.getUpdate();
  const name = update?.name ?? update?.$set?.name;
  if (name) {
    const slug = generateSlug(name);
    if (update.$set) {
      update.$set.slug = slug;
    } else {
      update.slug = slug;
    }
  }
}

categorySchema.pre('findOneAndUpdate', slugMiddleware);
categorySchema.pre('updateOne', slugMiddleware);

// Slug must be unique within a tenant (not globally)
categorySchema.index({ tenantId: 1, slug: 1 }, { unique: true });
// Prevent the same tenant from creating duplicate category names (case-insensitive)
categorySchema.index({ tenantId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
categorySchema.index({ tenantId: 1, status: 1 });

export const Category = model<ICategory>('Category', categorySchema);
