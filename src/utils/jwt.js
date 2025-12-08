import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET;
if (!secret) {
  throw new Error("JWT_SECRET is required");
}

export function signAccessToken(payload) {
  return jwt.sign(payload, secret, {
    expiresIn: process.env.JWT_EXPIRES || "30d",
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, secret);
}
