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
  destination: (req, file, cb) => {
    const partnerId = req.partnerId || "temp";
    const uploadPath = path.join("uploads", "profileDocs", partnerId.toString());
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uploaderId = req.user ? req.user.sub : "self";
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${uploaderId}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    return cb(null, true);
  }
  return cb(new Error("Only JPG, PNG, and PDF files are allowed"), false);
};

export const partnerUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});

