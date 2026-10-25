import { ContactInquiry } from './contactInquiry.model';
import { IContactInquiry } from './contactInquiry.interface';
import { getIO } from '../../socket';
import { User } from '../auth/auth.model';

// Detect marketing source based on UTM params, click IDs, or explicit source
const detectSource = (data: Partial<IContactInquiry>): string => {
  if (data.source && data.source !== 'direct' && data.source !== 'other') {
    return data.source.toLowerCase();
  }
  if (data.fbclid || (data.utmSource && /facebook|fb|ig|instagram/i.test(data.utmSource))) {
    return 'facebook';
  }
  if (data.gclid || (data.utmSource && /google|adwords/i.test(data.utmSource))) {
    return 'google';
  }
  if (data.utmSource) {
    return data.utmSource.toLowerCase();
  }
  return 'direct';
};

const createInquiry = async (data: Partial<IContactInquiry>) => {
  const normalizedSource = detectSource(data);
  const inquiry = await ContactInquiry.create({
    ...data,
    source: normalizedSource,
  });

  // Real-time socket notification to all Super Admins
  try {
    const io = getIO();
    if (io) {
      const superAdmins = await User.find({ role: 'super_admin' }).select('_id');
      superAdmins.forEach((admin) => {
        io.to(`user_${admin._id.toString()}`).emit('new_inquiry', inquiry);
        io.to(`user_${admin._id.toString()}`).emit('refresh_inquiries');
      });
      io.emit('refresh_inquiries');
    }
  } catch (err) {
    // Socket emit failure should not block inquiry creation
  }

  return inquiry;
};

interface IGetAllInquiriesFilter {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  source?: string;
  topic?: string;
  startDate?: string;
  endDate?: string;
}

const getAllInquiries = async (filterParams: IGetAllInquiriesFilter = {}) => {
  const page = Math.max(1, Number(filterParams.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(filterParams.limit) || 10));
  const skip = (page - 1) * limit;

  const query: any = {};

  if (filterParams.status && filterParams.status !== 'all') {
    query.status = filterParams.status;
  }

  if (filterParams.source && filterParams.source !== 'all') {
    if (filterParams.source === 'facebook') {
      query.$or = [
        { source: 'facebook' },
        { utmSource: { $regex: /facebook|fb|ig|instagram/i } },
        { fbclid: { $exists: true, $ne: '' } },
      ];
    } else if (filterParams.source === 'google') {
      query.$or = [
        { source: 'google' },
        { utmSource: { $regex: /google|adwords/i } },
        { gclid: { $exists: true, $ne: '' } },
      ];
    } else if (filterParams.source === 'direct') {
      query.$and = [
        { source: { $nin: ['facebook', 'google'] } },
        { utmSource: { $not: /facebook|fb|ig|instagram|google|adwords/i } },
        { fbclid: { $in: ['', null] } },
        { gclid: { $in: ['', null] } },
      ];
    } else {
      query.source = filterParams.source;
    }
  }

  if (filterParams.topic && filterParams.topic !== 'all') {
    query.topic = filterParams.topic;
  }

  if (filterParams.search && filterParams.search.trim()) {
    const s = filterParams.search.trim();
    const searchRegex = { $regex: s, $options: 'i' };
    const searchCondition = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { phone: searchRegex },
      { email: searchRegex },
      { businessName: searchRegex },
      { utmCampaign: searchRegex },
      { message: searchRegex },
    ];

    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: searchCondition }];
      delete query.$or;
    } else {
      query.$or = searchCondition;
    }
  }

  if (filterParams.startDate || filterParams.endDate) {
    query.createdAt = {};
    if (filterParams.startDate) {
      query.createdAt.$gte = new Date(filterParams.startDate);
    }
    if (filterParams.endDate) {
      const end = new Date(filterParams.endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  const [inquiries, total] = await Promise.all([
    ContactInquiry.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ContactInquiry.countDocuments(query),
  ]);

  return {
    data: inquiries,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

const getInquiryStats = async () => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalLeads,
    pendingLeads,
    contactedLeads,
    resolvedLeads,
    todayLeads,
    thisWeekLeads,
    thisMonthLeads,
    facebookLeads,
    googleLeads,
    directLeads,
    topicAgg,
  ] = await Promise.all([
    ContactInquiry.countDocuments(),
    ContactInquiry.countDocuments({ status: 'pending' }),
    ContactInquiry.countDocuments({ status: 'contacted' }),
    ContactInquiry.countDocuments({ status: 'resolved' }),
    ContactInquiry.countDocuments({ createdAt: { $gte: startOfToday } }),
    ContactInquiry.countDocuments({ createdAt: { $gte: startOfWeek } }),
    ContactInquiry.countDocuments({ createdAt: { $gte: startOfMonth } }),
    ContactInquiry.countDocuments({
      $or: [
        { source: 'facebook' },
        { utmSource: { $regex: /facebook|fb|ig|instagram/i } },
        { fbclid: { $exists: true, $ne: '' } },
      ],
    }),
    ContactInquiry.countDocuments({
      $or: [
        { source: 'google' },
        { utmSource: { $regex: /google|adwords/i } },
        { gclid: { $exists: true, $ne: '' } },
      ],
    }),
    ContactInquiry.countDocuments({
      $and: [
        { source: { $nin: ['facebook', 'google'] } },
        { utmSource: { $not: /facebook|fb|ig|instagram|google|adwords/i } },
        { fbclid: { $in: ['', null] } },
        { gclid: { $in: ['', null] } },
      ],
    }),
    ContactInquiry.aggregate([
      { $group: { _id: '$topic', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
  ]);

  return {
    totalLeads,
    pendingLeads,
    contactedLeads,
    resolvedLeads,
    todayLeads,
    thisWeekLeads,
    thisMonthLeads,
    facebookLeads,
    googleLeads,
    directLeads,
    topicBreakdown: topicAgg.map(t => ({ topic: t._id, count: t.count })),
  };
};

const updateInquiryStatus = async (
  id: string,
  updateData: { status?: 'pending' | 'contacted' | 'resolved' | 'cancelled'; adminNotes?: string }
) => {
  const inquiry = await ContactInquiry.findByIdAndUpdate(
    id,
    { $set: updateData },
    { returnDocument: 'after' }
  );
  return inquiry;
};

const deleteInquiry = async (id: string) => {
  const result = await ContactInquiry.findByIdAndDelete(id);
  return result;
};

export const contactInquiryService = {
  createInquiry,
  getAllInquiries,
  getInquiryStats,
  updateInquiryStatus,
  deleteInquiry,
};
