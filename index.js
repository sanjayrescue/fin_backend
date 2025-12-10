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
import { connectDB } from "./src/db/db.js";
import dotenv from "dotenv";
import path from "path";
import cron from "node-cron";
import { createServer } from "http";
import { Server } from "socket.io";
import { cleanupRejectedApps } from "./src/jobs/cleanupRejectedApps.js";

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
app.use(express.json({ limit: "1mb" }));
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
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
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

app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  socket.on("joinRole", (role) => {
    socket.join(role);
    console.log(`${socket.id} joined role: ${role}`);
  });

  socket.on("messageToRole", ({ role, msg }) => {
    io.to(role).emit("message", { role, msg, from: socket.id });
  });

  socket.on("privateMessage", ({ socketId, msg }) => {
    io.to(socketId).emit("message", { msg, from: socket.id });
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

connectDB(process.env.MONGO_URI)
  .then(() => {
    server.listen(PORT, () => console.log(`API running on :${PORT}`));

    cron.schedule("0 2 * * *", () => {
      console.log("Running daily cleanup for rejected applications...");
      cleanupRejectedApps();
    });
  })
  .catch((e) => {
    console.error("DB connect error:", e);
    process.exit(1);
  });