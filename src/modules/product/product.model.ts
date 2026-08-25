import { Schema, model } from 'mongoose';
import { IProduct } from './product.interface';

const productSchema = new Schema<IProduct>(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true },
    shortDescription: { type: String },
    description: { type: String },
    images: [{
      public_id: { type: String, required: true },
      secure_url: { type: String, required: true }
    }],
    specifications: [{
      group: { type: String },
      entries: [{
        name: { type: String },
        value: { type: String }
      }]
    }],
    originalPrice: { type: Number, required: true },
    discountedPrice: { type: Number, required: true },
    saveAmount: { type: Number, required: true },
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
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    stock: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

function generateSlug(title: string, suffix?: string): string {
  // Remove special characters, keep spaces to replace with hyphens, and ensure no consecutive hyphens
  let slug = title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/[\s-]+/g, '-');
  
  if (suffix) {
    const cleanSuffix = suffix.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/[\s-]+/g, '-');
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

export const Product = model<IProduct>('Product', productSchema);
