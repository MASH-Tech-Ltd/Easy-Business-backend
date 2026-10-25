import { Request, Response } from 'express';
import { contactInquiryService } from './contactInquiry.service';
import { getClientIp } from '../../utils/ipHelper';

export const createInquiry = async (req: Request, res: Response) => {
  try {
    const ipAddress = getClientIp(req);
    const inquiry = await contactInquiryService.createInquiry({ ...req.body, ipAddress });
    res.status(201).json({ success: true, data: inquiry, message: 'Inquiry submitted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllInquiries = async (req: Request, res: Response) => {
  try {
    const { page, limit, search, status, source, topic, startDate, endDate } = req.query;
    const result = await contactInquiryService.getAllInquiries({
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 10,
      search: search as string,
      status: status as string,
      source: source as string,
      topic: topic as string,
      startDate: startDate as string,
      endDate: endDate as string,
    });
    res.status(200).json({ success: true, data: result.data, meta: result.meta });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getInquiryStats = async (_req: Request, res: Response) => {
  try {
    const stats = await contactInquiryService.getInquiryStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateInquiryStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;
    
    const updatePayload: any = {};
    if (status !== undefined) updatePayload.status = status;
    if (adminNotes !== undefined) updatePayload.adminNotes = adminNotes;

    const inquiry = await contactInquiryService.updateInquiryStatus(id as string, updatePayload);
    if (!inquiry) {
      return res.status(404).json({ success: false, message: 'Inquiry not found' });
    }
    res.status(200).json({ success: true, data: inquiry, message: 'Inquiry updated successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteInquiry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await contactInquiryService.deleteInquiry(id as string);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Inquiry not found' });
    }
    res.status(200).json({ success: true, message: 'Inquiry deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
