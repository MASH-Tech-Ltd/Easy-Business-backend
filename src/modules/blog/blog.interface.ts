export interface IBlog {
  _id?: string;
  title: string;
  slug?: string;
  excerpt: string;
  content: string;
  category: string;
  tags?: string[];
  thumbnail?: string;
  author: string;
  authorRole?: string;
  readTime: string;
  isPublished: boolean;
  publishedAt?: Date;
  views: number;
  featured?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IBlogFilterOptions {
  page?: string | number;
  limit?: string | number;
  searchTerm?: string;
  category?: string;
  status?: 'all' | 'published' | 'draft';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
