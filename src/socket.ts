import { Server, Socket } from "socket.io";
import http from "http";
import config from "./config";

let io: Server | null = null;

export const initSocket = (httpServer: http.Server): Server => {
  if (io) return io;

  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:4173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173"
  ];

  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Join a room for a specific ticket
    socket.on("join_ticket", (ticketId: string) => {
      socket.join(`ticket_${ticketId}`);
      console.log(`Socket ${socket.id} joined ticket_${ticketId}`);
    });

    socket.on("leave_ticket", (ticketId: string) => {
      socket.leave(`ticket_${ticketId}`);
      console.log(`Socket ${socket.id} left ticket_${ticketId}`);
    });

    socket.on("join_user_room", (userId: string) => {
      socket.join(`user_${userId}`);
      console.log(`Socket ${socket.id} joined user_${userId}`);
    });

    socket.on("leave_user_room", (userId: string) => {
      socket.leave(`user_${userId}`);
      console.log(`Socket ${socket.id} left user_${userId}`);
    });

    socket.on("typing_start", (data: { ticketId: string, senderName: string }) => {
      socket.to(`ticket_${data.ticketId}`).emit("typing_start", data);
    });

    socket.on("typing_end", (data: { ticketId: string }) => {
      socket.to(`ticket_${data.ticketId}`).emit("typing_end", data);
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};
