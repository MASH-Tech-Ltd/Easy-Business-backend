import mongoose, { Schema, model } from 'mongoose';
import {
  IAnalyticsEvent,
  IProductDailyAnalytics,
  IStoreDailyAnalytics,
} from './analytics.interface';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Granular Analytics Event Schema
// ─────────────────────────────────────────────────────────────────────────────
const analyticsEventSchema = new Schema<IAnalyticsEvent>(
  {
    eventType: {
      type: String,
      enum: ['product_impression', 'product_click', 'store_visit'],
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    visitorId: {
      type: String,
      default: null,
      index: true,
    },
    sourcePage: {
      type: String,
      default: '/',
    },
    sourceSection: {
      type: String,
      default: 'general',
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    dateStr: {
      type: String,
      required: true,
      index: true,
    },
    ipAddress: {
      type: String,
      default: '',
    },
    userAgent: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// High-performance compound indexes for dashboard aggregation & queries
analyticsEventSchema.index({ tenantId: 1, eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ tenantId: 1, productId: 1, eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ tenantId: 1, dateStr: 1, eventType: 1 });
analyticsEventSchema.index({ tenantId: 1, sessionId: 1, productId: 1, eventType: 1 });

export const AnalyticsEvent = model<IAnalyticsEvent>('AnalyticsEvent', analyticsEventSchema);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Product Daily Aggregated Analytics Schema
// ─────────────────────────────────────────────────────────────────────────────
const productDailyAnalyticsSchema = new Schema<IProductDailyAnalytics>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    dateStr: {
      type: String,
      required: true,
      index: true,
    },
    impressions: {
      type: Number,
      default: 0,
    },
    clicks: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

productDailyAnalyticsSchema.index(
  { tenantId: 1, productId: 1, dateStr: 1 },
  { unique: true }
);
productDailyAnalyticsSchema.index({ tenantId: 1, dateStr: 1, impressions: -1 });
productDailyAnalyticsSchema.index({ tenantId: 1, dateStr: 1, clicks: -1 });

export const ProductDailyAnalytics = model<IProductDailyAnalytics>(
  'ProductDailyAnalytics',
  productDailyAnalyticsSchema
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Store Daily Aggregated Analytics Schema
// ─────────────────────────────────────────────────────────────────────────────
const storeDailyAnalyticsSchema = new Schema<IStoreDailyAnalytics>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    dateStr: {
      type: String,
      required: true,
      index: true,
    },
    visits: {
      type: Number,
      default: 0,
    },
    impressions: {
      type: Number,
      default: 0,
    },
    clicks: {
      type: Number,
      default: 0,
    },
    uniqueVisitorsCount: {
      type: Number,
      default: 0,
    },
    uniqueVisitors: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

storeDailyAnalyticsSchema.index({ tenantId: 1, dateStr: 1 }, { unique: true });
storeDailyAnalyticsSchema.index({ dateStr: 1, visits: -1 });

export const StoreDailyAnalytics = model<IStoreDailyAnalytics>(
  'StoreDailyAnalytics',
  storeDailyAnalyticsSchema
);

