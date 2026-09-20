import { Types } from "mongoose";
import { SupportTicket } from "./support.model";

export const supportService = {
  async notifyListUpdate(merchantId?: string) {
    try {
      const io = require("../../socket").getIO();
      const { User } = require("../auth/auth.model");
      const superAdmins = await User.find({ role: "super_admin" });
      for (const admin of superAdmins) {
        io.to(`user_${admin._id.toString()}`).emit("refresh_tickets");
      }
      if (merchantId) {
        io.to(`user_${merchantId.toString()}`).emit("refresh_tickets");
      }
    } catch (err) {}
  },

  generateTicketId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "TKT-";
    for (let i = 0; i < 7; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  async createTicket(
    tenantId: string,
    subject: string,
    message: string,
    userId: string,
  ) {
    const ticket = await SupportTicket.create({
      ticketId: this.generateTicketId(),
      tenantId,
      subject,
      messages: [
        {
          senderType: "MERCHANT",
          senderId: userId,
          message,
        },
      ],
    });

    await this.notifyListUpdate(userId);

    // Notify the merchant that their ticket was received
    try {
      const {
        notificationService,
      } = require("../notification/notification.service");
      const { User } = require("../auth/auth.model");

      // Notify Merchant
      await notificationService.createNotification(
        userId,
        "TICKET_CREATED",
        "Ticket Created",
        `Your support ticket "${subject}" has been successfully submitted.`,
        ticket._id,
        tenantId,
      );

      // Populate tenantId so the frontend table displays the name correctly
      await ticket.populate("tenantId", "name domain slug");

      // Notify all Super Admins and emit new_ticket for realtime UI update
      const superAdmins = await User.find({ role: "super_admin" });
      for (const admin of superAdmins) {
        await notificationService.createNotification(
          admin._id.toString(),
          "TICKET_CREATED",
          "New Support Ticket",
          `A new support ticket "${subject}" has been created.`,
          ticket._id,
          tenantId,
        );

        // Also emit the ticket data to the admin's room for the SupportList UI
        try {
          const io = require("../../socket").getIO();
          io.to(`user_${admin._id.toString()}`).emit("new_ticket", ticket);
        } catch (err) {
          console.error("Socket emit new_ticket error:", err);
        }
      }
    } catch (err) {
      console.error("Notification error on create:", err);
    }

    return ticket;
  },

  async getMerchantTickets(tenantId: string) {
    return await SupportTicket.find({ tenantId }).sort({ updatedAt: -1 });
  },

  async getAllTickets(search = "", page = 1, limit = 10, timeFilter = "all") {
    const query: any = {};

    // Apply time filter
    if (timeFilter && timeFilter !== "all") {
      const now = new Date();
      if (timeFilter === "weekly") {
        const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        query.createdAt = { $gte: lastWeek };
      } else if (timeFilter === "monthly") {
        const lastMonth = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          now.getDate(),
        );
        query.createdAt = { $gte: lastMonth };
      } else if (timeFilter === "yearly") {
        const lastYear = new Date(
          now.getFullYear() - 1,
          now.getMonth(),
          now.getDate(),
        );
        query.createdAt = { $gte: lastYear };
      }
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");

      // Look up tenants matching the search string
      const { Tenant } = require("../tenant/tenant.model");
      const matchingTenants = await Tenant.find({
        $or: [{ name: searchRegex }, { domain: searchRegex }],
      }).select("_id");

      const tenantIds = matchingTenants.map((t: any) => t._id);

      query.$or = [
        { ticketId: searchRegex },
        { subject: searchRegex },
        { tenantId: { $in: tenantIds } },
      ];
    }

    const skip = (page - 1) * limit;

    const [data, totalCount] = await Promise.all([
      SupportTicket.find(query)
        .populate("tenantId", "name domain slug")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      SupportTicket.countDocuments(query),
    ]);

    return {
      data,
      pagination: {
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page,
        limit,
      },
    };
  },

  async getTicketStats(timeFilter = "all") {
    const matchQuery: any = {};

    // Apply time filter
    if (timeFilter && timeFilter !== "all") {
      const now = new Date();
      if (timeFilter === "weekly") {
        const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        matchQuery.createdAt = { $gte: lastWeek };
      } else if (timeFilter === "monthly") {
        const lastMonth = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          now.getDate(),
        );
        matchQuery.createdAt = { $gte: lastMonth };
      } else if (timeFilter === "yearly") {
        const lastYear = new Date(
          now.getFullYear() - 1,
          now.getMonth(),
          now.getDate(),
        );
        matchQuery.createdAt = { $gte: lastYear };
      }
    }

    const tickets =
      await SupportTicket.find(matchQuery).select("status createdAt");

    let solved = 0;
    let pending = 0;
    let open = 0;
    let closed = 0;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    let thisMonthCount = 0;
    let thisYearCount = 0;

    tickets.forEach((t) => {
      if (t.status === "RESOLVED") solved++;
      else if (t.status === "IN_PROGRESS") pending++;
      else if (t.status === "OPEN") open++;
      else if (t.status === "CLOSED") closed++;

      const created = new Date(t.createdAt);
      if (created.getFullYear() === currentYear) {
        thisYearCount++;
        if (created.getMonth() === currentMonth) {
          thisMonthCount++;
        }
      }
    });

    return {
      solved,
      pending,
      open,
      closed,
      total: tickets.length,
      thisMonthCount,
      thisYearCount,
    };
  },

  async updateTicketPriority(
    ticketId: string,
    priority: "LOW" | "MEDIUM" | "HIGH",
  ) {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) return null;

    ticket.priority = priority;
    await ticket.save();

    // Optionally emit socket update for realtime
    try {
      const io = require("../../socket").getIO();
      io.to(`ticket_${ticket.ticketId}`).emit("priority_changed", priority);
      this.notifyListUpdate(ticket.messages[0]?.senderId?.toString());
    } catch (err) {}

    return ticket;
  },

  async getTicketDetails(ticketId: string, tenantId?: string) {
    const query: any = { _id: ticketId };
    if (tenantId) {
      query.tenantId = tenantId;
    }
    return await SupportTicket.findOne(query)
      .populate("tenantId", "name domain slug")
      .populate("messages.senderId", "name email");
  },

  async replyToTicket(
    ticketId: string,
    senderType: "MERCHANT" | "ADMIN",
    senderId: string,
    message: string,
    tenantId?: string,
  ) {
    const query: any = { _id: ticketId };
    if (tenantId) query.tenantId = tenantId;

    const ticket = await SupportTicket.findOne(query);
    if (!ticket) throw new Error("Ticket not found");

    const newMessage = {
      senderType,
      senderId: new Types.ObjectId(senderId),
      message,
    };

    // Automatically reopen ticket if merchant replies to a closed ticket
    if (senderType === "MERCHANT" && ticket.status === "CLOSED") {
      ticket.status = "OPEN";
    }

    ticket.messages.push(newMessage as any);
    await ticket.save();

    // Populate the sender details before emitting the socket event
    await ticket.populate("messages.senderId", "name email");

    const savedMessage = ticket.messages[ticket.messages.length - 1];

    // Emit socket event
    try {
      const io = require("../../socket").getIO();
      io.to(`ticket_${ticket.ticketId}`).emit("new_message", savedMessage);
    } catch (err) {
      console.error("Socket emit error:", err);
    }

    // Notify the other party
    try {
      const { notificationService } = require("../notification/notification.service");
      const { User } = require("../auth/auth.model");

      if (senderType === "ADMIN") {
        // Find the merchant who created the ticket (the first message sender)
        const merchantUser = ticket.messages[0]?.senderId as any;
        // Handle populated object or raw ObjectId string
        const merchantId = merchantUser?._id ? merchantUser._id.toString() : merchantUser?.toString();
        
        if (merchantId) {
          await notificationService.createNotification(
            merchantId,
            "TICKET_REPLY",
            "New Reply to Ticket",
            `An admin has replied to your ticket: ${ticket.subject}`,
            ticket._id,
            ticket.tenantId
          );
        }
      } else if (senderType === "MERCHANT") {
        // Notify all Super Admins
        const superAdmins = await User.find({ role: "super_admin" });
        for (const admin of superAdmins) {
          await notificationService.createNotification(
            admin._id.toString(),
            "TICKET_REPLY",
            "New Ticket Reply",
            `A merchant has replied to ticket: ${ticket.subject}`,
            ticket._id,
            ticket.tenantId
          );
        }
      }
    } catch (err) {
      console.error("Notification error on reply:", err);
    }

    return ticket;
  },

  // SECURITY FIX: tenantId scopes the update to a specific tenant's ticket
  // super_admin passes undefined (no scope), tenant_admin passes their tenantId
  async updateTicketStatus(
    ticketId: string,
    status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED",
    tenantId?: string,
  ) {
    const query: any = { _id: ticketId };
    if (tenantId) query.tenantId = tenantId;

    const ticket = await SupportTicket.findOne(query);
    if (!ticket) {
      return null;
    }

    ticket.status = status;
    await ticket.save();

    // Emit socket event
    try {
      const io = require("../../socket").getIO();
      io.to(`ticket_${ticket.ticketId}`).emit("status_changed", status);
      await this.notifyListUpdate(ticket.messages[0]?.senderId?.toString());
    } catch (err) {
      console.error("Socket emit error:", err);
    }

    // Notify the merchant
    try {
      const {
        notificationService,
      } = require("../notification/notification.service");
      const merchantId = ticket.messages[0]?.senderId;
      if (merchantId) {
        await notificationService.createNotification(
          merchantId.toString(),
          "TICKET_STATUS",
          "Ticket Status Updated",
          `Your ticket "${ticket.subject}" has been marked as ${status}.`,
          ticket._id,
          ticket.tenantId,
        );
      }
    } catch (err) {
      console.error("Notification error on status update:", err);
    }

    return ticket;
  },

  // SECURITY FIX: tenantId scopes the delete to a specific tenant's ticket
  async deleteTicket(ticketId: string, tenantId?: string) {
    const query: any = { _id: ticketId };
    if (tenantId) query.tenantId = tenantId;

    const ticket = await SupportTicket.findOne(query);
    if (!ticket) {
      return null;
    }

    // Emit event before deleting so clients can redirect
    try {
      const io = require("../../socket").getIO();
      io.to(`ticket_${ticket.ticketId}`).emit("ticket_deleted");
      await this.notifyListUpdate(ticket.messages[0]?.senderId?.toString());
    } catch (err) {
      console.error("Socket emit error:", err);
    }

    await SupportTicket.findByIdAndDelete(ticketId);
    return ticket;
  },
};
