import { Request, Response } from 'express';
import { supportService } from './support.service';

export const createTicket = async (req: Request, res: Response) => {
  try {
    const { subject, message } = req.body;
    const tenantId = (req as any).user.tenantId;
    const userId = (req as any).user._id;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID is required' });
    }

    const ticket = await supportService.createTicket(tenantId, subject, message, userId);
    res.status(201).json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMerchantTickets = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user.tenantId;
    const tickets = await supportService.getMerchantTickets(tenantId);
    res.status(200).json({ success: true, data: tickets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllTickets = async (req: Request, res: Response) => {
  try {
    const tickets = await supportService.getAllTickets();
    res.status(200).json({ success: true, data: tickets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTicketDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userRole = (req as any).user.role;
    const tenantId = userRole === 'super_admin' ? undefined : (req as any).user.tenantId;

    const ticket = await supportService.getTicketDetails(id as string, tenantId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    res.status(200).json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const replyToTicket = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userRole = (req as any).user.role;
    const senderType = userRole === 'super_admin' ? 'ADMIN' : 'MERCHANT';
    const userId = (req as any).user._id;
    const tenantId = userRole === 'super_admin' ? undefined : (req as any).user.tenantId;

    const ticket = await supportService.replyToTicket(id as string, senderType, userId, message, tenantId);
    res.status(200).json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTicketStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Both super admin and tenant admin can update status
    const role = (req as any).user.role;
    if (role !== 'super_admin' && role !== 'tenant_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const ticket = await supportService.updateTicketStatus(id as string, status);
    res.status(200).json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTicket = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const role = (req as any).user.role;
    
    // Both super admin and tenant admin can delete
    if (role !== 'super_admin' && role !== 'tenant_admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await supportService.deleteTicket(id as string);
    res.status(200).json({ success: true, message: 'Ticket deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
