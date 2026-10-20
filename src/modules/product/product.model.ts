import { Schema, model } from 'mongoose';
import { IProduct } from './product.interface';

const productSchema = new Schema<IProduct>(
  {
    title: { type: String, required: [true, 'Product title is required'] },
    slug: { type: String, required: [true, 'Product slug is required'] },
    shortDescription: { type: String },
    description: { type: String },
    images: [{
      public_id: { type: String, required: [true, 'Image public_id is required'] },
      secure_url: { type: String, required: [true, 'Image URL is required'] }
    }],
    specifications: [{
      group: { type: String },
      entries: [{
        name: { type: String },
        value: { type: String }
      }]
    }],
    originalPrice: { type: Number, required: [true, 'Regular price is required'] },
    discountedPrice: { type: Number, required: [true, 'Selling price is required'] },
    saveAmount: { type: Number, required: [true, 'Save amount is required'] },
    badgeText: { type: String },
    features: { type: [String], default: [] },
    videos: { type: [String], default: [] },
    isAuthentic: { type: Boolean, default: false },
    brand: { type: String },
    weight: { type: Number },
    dimensions: {
      length: { type: Number },
      width: { type: Number },
      height: { type: Number }
    },
    condition: { type: String, enum: ['New', 'Refurbished', 'Used'], default: 'New' },
    status: { type: String, enum: ['ACTIVE', 'DRAFT', 'ARCHIVED'], default: 'ACTIVE' },
    sku: { type: String },
    unit: { type: String },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: [true, 'Category is required'] },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: [true, 'Tenant ID is required'] },
    stock: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

function generateSlug(title: string, suffix?: string): string {
  // Support Unicode letters \p{L}, combining marks \p{M} (like Bengali vowels), and numbers \p{N}
  let slug = title.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '').replace(/[\s-]+/g, '-');
  
  if (suffix) {
    const cleanSuffix = suffix.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\s-]/gu, '').replace(/[\s-]+/g, '-');
    slug = `${slug}-${cleanSuffix}`;
  }
  
  return slug;
}

productSchema.pre('validate', function() {
  if (this.title && !this.slug) {
    this.slug = generateSlug(this.title, this.sku);
  }
});

productSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
productSchema.index({ tenantId: 1, status: 1, stock: -1, createdAt: -1 });
productSchema.index({ tenantId: 1, status: 1, categoryId: 1, stock: -1, createdAt: -1 });
productSchema.index({ tenantId: 1, status: 1, salesCount: -1, createdAt: -1 });
productSchema.index({ tenantId: 1, status: 1, brand: 1, createdAt: -1 });
productSchema.index({ title: 'text', brand: 'text' });

export const Product = model<IProduct>('Product', productSchema);
