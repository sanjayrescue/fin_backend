import multer from "multer";
import path from "path";
import fs from "fs";

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/jpg",
  "application/pdf",
];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Allow uploads for both authenticated and public flows
    const ownerId = req.user?.sub || req.headers["x-upload-user"] || "public";
    const uploadPath = path.join("uploads", ownerId.toString());
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    return cb(null, true);
  }
  return cb(new Error("Only JPG, PNG, and PDF files are allowed"), false);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});
