// Notification Service - Handles MongoDB persistence of notifications
import mongoose from "mongoose";
import { Notification } from "../models/Notification.js";

/**
 * Generate unique notification ID for deduplication
 */
export const generateNotificationId = (data) => {
  const { applicationId, docType, status, timestamp, userId, type } = data;
  
  if (applicationId && docType && status) {
    return `${applicationId}_${docType}_${status}_${timestamp || Date.now()}`;
  }
  
  if (applicationId && status) {
    return `${applicationId}_${status}_${timestamp || Date.now()}`;
  }
  
  if (type && userId) {
    return `${type}_${userId}_${timestamp || Date.now()}`;
  }
  
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Convert userId to ObjectId if it's a string
 * Handles both string and ObjectId formats
 */
const toObjectId = (id) => {
  if (!id) {
    console.warn(`⚠️ toObjectId: No id provided`);
    return null;
  }
  
  // If already an ObjectId, return as is
  if (id instanceof mongoose.Types.ObjectId) {
    return id;
  }
  
  // If string, validate and convert
  if (typeof id === 'string') {
    if (mongoose.Types.ObjectId.isValid(id)) {
      return new mongoose.Types.ObjectId(id);
    } else {
      console.error(`⚠️ Invalid userId string format: ${id}`);
      return null;
    }
  }
  
  // Try to convert to string first, then to ObjectId
  try {
    const idString = String(id);
    if (mongoose.Types.ObjectId.isValid(idString)) {
      return new mongoose.Types.ObjectId(idString);
    }
  } catch (err) {
    console.error(`⚠️ Error converting userId to ObjectId:`, err);
  }
  
  console.error(`⚠️ Invalid userId format: ${id} (type: ${typeof id})`);
  return null;
};

/**
 * Create and save notification to MongoDB for a single user
 * Returns the saved notification or null if duplicate/error
 */
export const createNotification = async (userId, notificationData) => {
  try {
    // Convert userId to ObjectId
    const userIdObjectId = toObjectId(userId);
    if (!userIdObjectId) {
      console.error(`❌ Invalid userId provided: ${userId}`);
      return null;
    }

    const {
      type,
      title,
      message,
      data,
      actionBy,
      loanInfo,
      notificationId: providedNotificationId,
      timestamp,
    } = notificationData;

    // Generate notification ID if not provided
    const notificationId = providedNotificationId || generateNotificationId({
      ...data,
      userId: userIdObjectId.toString(),
      type,
      timestamp: timestamp || Date.now(),
    });

    // Check if notification already exists (deduplication) - use flexible query
    // Try both ObjectId and string formats
    const existing = await Notification.findOne({
      $or: [
        { userId: userIdObjectId },
        { userId: userIdObjectId.toString() },
        { userId: userId }, // Also try original input format
      ],
      notificationId,
    });

    if (existing) {
      console.log(`⚠️ Duplicate notification skipped for user ${userIdObjectId}: ${notificationId}`);
      return existing;
    }

    // Create new notification - ALWAYS use ObjectId format for consistency
    const notification = new Notification({
      userId: userIdObjectId, // Always store as ObjectId
      type: type || "info",
      title: title || "Notification",
      message: message || "You have a new notification",
      read: false,
      timestamp: timestamp || new Date(),
      data: data || {},
      actionBy: actionBy || null,
      loanInfo: loanInfo || null,
      notificationId,
    });

    const savedNotification = await notification.save();
    
    // Verify what was actually saved
    const savedUserId = savedNotification.userId;
    const savedUserIdStr = savedUserId?.toString ? savedUserId.toString() : String(savedUserId);
    
    console.log(`✅ Notification created and saved to MongoDB`, {
      notificationId: savedNotification._id,
      userIdStored: savedUserIdStr,
      userIdStoredType: typeof savedNotification.userId,
      userIdStoredIsObjectId: savedNotification.userId instanceof mongoose.Types.ObjectId,
      originalUserIdInput: userId,
      convertedUserId: userIdObjectId.toString(),
      type: savedNotification.type,
      title: savedNotification.title,
    });
    
    return savedNotification;
  } catch (error) {
    console.error(`❌ Error creating notification for user ${userId}:`, {
      error: error.message,
      stack: error.stack,
      code: error.code,
      userId,
      notificationData: {
        type: notificationData?.type,
        title: notificationData?.title,
        notificationId: notificationData?.notificationId,
      },
    });
    
    // If duplicate key error, try to find existing
    if (error.code === 11000) {
      const userIdObjectId = toObjectId(userId);
      if (userIdObjectId) {
        const existing = await Notification.findOne({
          userId: userIdObjectId,
          notificationId: notificationData?.notificationId,
        });
        if (existing) {
          console.log(`✅ Found existing notification (duplicate key): ${existing._id}`);
          return existing;
        }
      }
    }
    
    // Log validation errors
    if (error.name === 'ValidationError') {
      console.error(`❌ Validation error:`, error.errors);
    }
    
    return null;
  }
};

/**
 * Create notifications for multiple users
 * Returns array of created notifications
 */
export const createNotificationsForUsers = async (userIds, notificationData) => {
  if (!userIds || userIds.length === 0) {
    console.log(`⚠️ createNotificationsForUsers: No userIds provided`);
    return [];
  }

  const notifications = [];
  const errors = [];

  console.log(`📨 Creating notifications for ${userIds.length} users`);

  for (const userId of userIds) {
    try {
      const notification = await createNotification(userId, notificationData);
      if (notification) {
        notifications.push(notification);
      } else {
        errors.push({ userId, error: "Notification creation returned null" });
      }
    } catch (error) {
      console.error(`❌ Error creating notification for user ${userId}:`, error.message);
      errors.push({ userId, error: error.message });
    }
  }

  if (errors.length > 0) {
    console.error(`❌ Errors creating notifications for ${errors.length} users:`, errors);
  }

  console.log(`✅ Successfully created ${notifications.length} notifications out of ${userIds.length} users`);
  return notifications;
};

/**
 * Create notification for a role (all users with that role)
 */
export const createNotificationForRole = async (role, notificationData) => {
  try {
    const { User } = await import("../models/User.js");
    const users = await User.find({ role }).select("_id").lean();
    const userIds = users.map(u => u._id.toString());
    
    return await createNotificationsForUsers(userIds, notificationData);
  } catch (error) {
    console.error(`❌ Error creating notifications for role ${role}:`, error);
    return [];
  }
};
