import { Document, Types } from 'mongoose';

export type AnalyticsEventType = 'product_impression' | 'product_click' | 'store_visit';

export interface IAnalyticsEvent extends Document {
  eventType: AnalyticsEventType;
  tenantId: Types.ObjectId;
  productId?: Types.ObjectId | null;
  sessionId: string;
  visitorId?: string | null;
  sourcePage?: string;
  sourceSection?: string | null;
  timestamp: Date;
  dateStr: string; // 'YYYY-MM-DD'
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductDailyAnalytics extends Document {
  tenantId: Types.ObjectId;
  productId: Types.ObjectId;
  dateStr: string; // 'YYYY-MM-DD'
  impressions: number;
  clicks: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStoreDailyAnalytics extends Document {
  tenantId: Types.ObjectId;
  dateStr: string; // 'YYYY-MM-DD'
  visits: number;
  impressions: number;
  clicks: number;
  uniqueVisitorsCount: number;
  uniqueVisitors: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ITrackEventInput {
  eventType: AnalyticsEventType;
  productId?: string;
  sourcePage?: string;
  sourceSection?: string;
  timestamp?: string | number | Date;
}

export interface ITrackBatchPayload {
  tenantId?: string;
  tenantSlug?: string;
  sessionId: string;
  visitorId?: string;
  events: ITrackEventInput[];
}

