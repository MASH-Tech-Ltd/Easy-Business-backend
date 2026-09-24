import { Request, Response } from 'express';
import { contactInquiryService } from './contactInquiry.service';

export const createInquiry = async (req: Request, res: Response) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress || 'Unknown';
    const inquiry = await contactInquiryService.createInquiry({ ...req.body, ipAddress });
    res.status(201).json({ success: true, data: inquiry, message: 'Inquiry submitted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllInquiries = async (req: Request, res: Response) => {
  try {
    const { page, limit } = req.query;
    const result = await contactInquiryService.getAllInquiries(
      parseInt(page as string) || 1,
      parseInt(limit as string) || 10
    );
    res.status(200).json({ success: true, data: result.data, meta: result.meta });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateInquiryStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const inquiry = await contactInquiryService.updateInquiryStatus(id as string, status);
    if (!inquiry) {
      return res.status(404).json({ success: false, message: 'Inquiry not found' });
    }
    res.status(200).json({ success: true, data: inquiry });
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
