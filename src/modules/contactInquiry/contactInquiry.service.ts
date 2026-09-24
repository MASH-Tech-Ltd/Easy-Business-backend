import { ContactInquiry } from './contactInquiry.model';
import { IContactInquiry } from './contactInquiry.interface';

const createInquiry = async (data: Partial<IContactInquiry>) => {
  const inquiry = await ContactInquiry.create(data);
  return inquiry;
};

const getAllInquiries = async (page: number = 1, limit: number = 10) => {
  const skip = (page - 1) * limit;
  const inquiries = await ContactInquiry.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
    
  const total = await ContactInquiry.countDocuments();
  
  return {
    data: inquiries,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  };
};

const updateInquiryStatus = async (id: string, status: 'pending' | 'resolved') => {
  const inquiry = await ContactInquiry.findByIdAndUpdate(
    id,
    { status },
    { new: true }
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
  updateInquiryStatus,
  deleteInquiry,
};
