import { Schema, model } from 'mongoose';
import { ICategory } from './category.interface';

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String },
    image: {
      public_id: { type: String },
      secure_url: { type: String }
    },
    status: { type: String, enum: ['ACTIVE', 'DRAFT'], default: 'ACTIVE' },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  },
  {
    timestamps: true,
  }
);

function generateSlug(name: string): string {
  // Support Unicode letters \p{L}, combining marks \p{M} (like Bengali vowels), and numbers \p{N}
  const base = name.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '').replace(/[\s-]+/g, '-');
  return base + '-' + Math.random().toString(36).substring(2, 8);
}

categorySchema.pre('validate', function() {
  if (this.name && !this.slug) {
    this.slug = generateSlug(this.name);
  }
});

categorySchema.pre('findOneAndUpdate', function() {
  const update: any = this.getUpdate();
  if (update && update.name && !update.slug) {
    update.slug = generateSlug(update.name);
  }
});

export const Category = model<ICategory>('Category', categorySchema);
