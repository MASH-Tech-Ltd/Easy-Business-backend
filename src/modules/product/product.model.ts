import { Schema, model } from 'mongoose';
import { IProduct } from './product.interface';

const productSchema = new Schema<IProduct>(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
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

function generateSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(2, 8);
}

productSchema.pre('validate', function() {
  if (this.title && !this.slug) {
    this.slug = generateSlug(this.title);
  }
});



export const Product = model<IProduct>('Product', productSchema);
