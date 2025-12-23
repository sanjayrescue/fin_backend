import "dotenv/config.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import authRoutes from "./src/routes/auth.routes.js";
import adminRoutes from "./src/routes/admin.routes.js";
import asmRoutes from "./src/routes/asm.routes.js";
import rmRoutes from "./src/routes/rm.routes.js";
import partnerRoutes from "./src/routes/partner.routes.js";
import contactRoutes from "./src/routes/contact.routes.js";
import customerRoutes from "./src/routes/customer.routes.js";
import notificationRoutes from "./src/routes/notification.routes.js";
import { connectDB } from "./src/db/db.js";
import dotenv from "dotenv";
import path from "path";
import cron from "node-cron";
import { createServer } from "http";
import { Server } from "socket.io";
import { cleanupRejectedApps } from "./src/jobs/cleanupRejectedApps.js";
import { initializeSocket } from "./src/socket/socketHandler.js";
import { Notification } from "./src/models/Notification.js";

dotenv.config();

const requiredEnv = ["MONGO_URI", "JWT_SECRET", "EMAIL_USER", "EMAIL_PASS"];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
});

const app = express();
const server = createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "https://frontend-ifyy.vercel.app",
  "https://trustlinefintech.com",
];

app.use(
  "/uploads",
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
  express.static(path.join(process.cwd(), "uploads"))
);

app.use(helmet());
app.use(hpp());
app.use(express.json({ limit: "50mb" })); // Increased for file uploads
app.use(express.urlencoded({ extended: true, limit: "50mb" })); // For multipart/form-data
app.use(morgan("tiny"));

// === RATE LIMITER FOR SENSITIVE ENDPOINTS ONLY ===
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20,
  message: "Too many attempts, try again later",
});

// Apply limiter ONLY on these sensitive routes
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/create-admin", authLimiter);
app.use("/api/auth/reset-password/request", authLimiter);
app.use("/api/auth/reset-password/confirm", authLimiter);
app.use("/api/partner/signup-partner", authLimiter);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // For development, allow local network IPs (React Native)
        if (origin.includes('10.100.12.2') || origin.includes('192.168.') || origin.includes('localhost')) {
          return callback(null, true);
        }
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    credentials: true,
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/asm", asmRoutes);
app.use("/api/rm", rmRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/notifications", notificationRoutes);

app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // For development, allow local network IPs (React Native)
        if (origin.includes('10.100.12.2') || origin.includes('192.168.') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  },
});

// Initialize socket handlers with authentication and all event handlers
initializeSocket(io);

// Export io for use in routes
export { io };

// Make io available globally for use in route handlers
global.io = io;

connectDB(process.env.MONGO_URI)
  .then(() => {
    server.listen(PORT, () => console.log(`API running on :${PORT}`));

    // Schedule daily cleanup for rejected applications
    cron.schedule("0 2 * * *", () => {
      console.log("Running daily cleanup for rejected applications...");
      cleanupRejectedApps();
    });

    // Schedule daily cleanup for old notifications (older than 30 days)
    cron.schedule("0 3 * * *", async () => {
      console.log("Running daily cleanup for old notifications...");
      try {
        await Notification.cleanupOldNotifications(30); // Keep notifications for 30 days
      } catch (error) {
        console.error("Error cleaning up old notifications:", error);
      }
    });
  })
  .catch((e) => {
    console.error("DB connect error:", e);
    process.exit(1);
  });