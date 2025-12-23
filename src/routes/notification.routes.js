// routes/notification.routes.js
import { Router } from "express";
import { auth } from "../middleware/auth.js";
import { Notification } from "../models/Notification.js";

const router = Router();

// GET /api/notifications - Get all notifications for the current user
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const { limit = 200, skip = 0 } = req.query;

    console.log(`📥 Fetching notifications for user ${userId} (type: ${typeof userId}), limit: ${limit}, skip: ${skip}`);
    console.log(`📥 User role: ${req.user?.role}, User from token:`, req.user);

    // Ensure userId is ObjectId
    const mongoose = await import("mongoose");
    const userIdObjectId = mongoose.default.Types.ObjectId.isValid(userId) 
      ? (typeof userId === 'string' ? new mongoose.default.Types.ObjectId(userId) : userId)
      : null;

    if (!userIdObjectId) {
      console.error(`❌ Invalid userId format: ${userId} (type: ${typeof userId})`);
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    console.log(`🔍 Querying notifications for userId: ${userIdObjectId.toString()} (ObjectId type)`);
    console.log(`🔍 userIdObjectId equals check:`, {
      original: userId,
      converted: userIdObjectId.toString(),
      match: userId === userIdObjectId.toString(),
    });
    
    // ULTIMATE FALLBACK APPROACH: Fetch ALL notifications and filter in memory
    // This guarantees we find notifications regardless of format issues
    console.log(`🔍 Using comprehensive query approach...`);
    console.log(`🔍 User info from token:`, {
      userId: userId,
      userIdType: typeof userId,
      userIdObjectId: userIdObjectId.toString(),
      userIdObjectIdHex: userIdObjectId.toHexString(),
      role: req.user?.role,
      fullUser: req.user,
    });
    
    // CRITICAL DEBUG: Log the exact userId from token to compare with notifications
    console.log(`🔴 DEBUG: Website token userId = "${userId}" (length: ${userId.length})`);
    
    // First check if there are any notifications at all
    const totalNotificationsInDB = await Notification.countDocuments({});
    console.log(`📊 Total notifications in database: ${totalNotificationsInDB}`);
    console.log(`📊 Querying for userId: ${userId} (string) or ${userIdObjectId.toString()} (ObjectId)`);
    
    let notifications = [];
    let unreadCount = 0;
    let totalCount = 0;
    
    if (totalNotificationsInDB > 0) {
      // Fetch ALL notifications (with reasonable limit) and filter in memory
      // This is the most reliable way to ensure we find matching notifications
      const allNotifications = await Notification.find({})
        .sort({ timestamp: -1 })
        .limit(1000) // Fetch up to 1000 notifications
        .lean();
      
      console.log(`📥 Fetched ${allNotifications.length} notifications from database for filtering`);
      
      // Get unique userIds from all notifications to see what's in the DB
      const uniqueUserIds = [...new Set(allNotifications.map(n => {
        const nUserIdStr = n.userId?.toString ? n.userId.toString() : String(n.userId);
        return nUserIdStr;
      }))];
      console.log(`📋 Unique userIds in database (first 20):`, uniqueUserIds.slice(0, 20));
      console.log(`📋 Query userId formats:`, {
        queryUserIdString: userId,
        queryUserIdStringLength: userId.length,
        queryUserIdObjectId: userIdObjectId.toString(),
        queryUserIdObjectIdLength: userIdObjectId.toString().length,
        queryUserIdObjectIdHex: userIdObjectId.toHexString(),
      });
      
      // CRITICAL DEBUG: Check if any notification userId matches exactly
      console.log(`🔴 DEBUG: Checking exact matches...`);
      allNotifications.slice(0, 10).forEach((n, idx) => {
        const nUserIdStr = n.userId?.toString ? n.userId.toString() : String(n.userId);
        const exactMatch = nUserIdStr === userId;
        const objectIdMatch = nUserIdStr === userIdObjectId.toString();
        console.log(`  Notification ${idx + 1}: stored="${nUserIdStr}" (len: ${nUserIdStr.length}) vs query="${userId}" (len: ${userId.length}) - exactMatch=${exactMatch}, objectIdMatch=${objectIdMatch}`);
      });
      
      // Filter by userId - compare as strings to handle any format
      const userIdStr = userIdObjectId.toString();
      const userIdHex = userIdObjectId.toHexString();
      
      // Also try to normalize the original userId string (remove any whitespace, etc.)
      const userIdNormalized = String(userId).trim();
      
      const filtered = allNotifications.filter(n => {
        // Get notification userId in multiple formats
        let nUserIdStr = null;
        let nUserIdObj = null;
        
        if (n.userId) {
          if (n.userId.toString) {
            nUserIdStr = n.userId.toString();
          } else {
            nUserIdStr = String(n.userId);
          }
          
          // Try to convert to ObjectId for comparison
          if (mongoose.default.Types.ObjectId.isValid(n.userId)) {
            try {
              nUserIdObj = n.userId instanceof mongoose.default.Types.ObjectId 
                ? n.userId 
                : new mongoose.default.Types.ObjectId(n.userId);
            } catch (e) {
              // Ignore conversion errors
            }
          }
        }
        
        if (!nUserIdStr) return false;
        
        // Try multiple comparison methods
        const matches = 
          nUserIdStr === userIdStr ||           // Exact ObjectId string match
          nUserIdStr === userId ||              // Original string match
          nUserIdStr === userIdHex ||            // Hex string match
          nUserIdStr === userIdNormalized ||     // Normalized string match
          (nUserIdObj && nUserIdObj.equals && nUserIdObj.equals(userIdObjectId)) || // ObjectId.equals()
          (nUserIdObj && userIdObjectId.equals && userIdObjectId.equals(nUserIdObj)); // Reverse ObjectId.equals()
        
        if (matches) {
          console.log(`✅ Match found! Notification userId: ${nUserIdStr}, Query userId: ${userIdStr}`);
        }
        return matches;
      });
      
      console.log(`🔍 Filtered to ${filtered.length} notifications for user ${userId}`);
      
      // If no matches, show detailed comparison
      if (filtered.length === 0) {
        console.log(`⚠️ ⚠️ ⚠️ NO MATCHING NOTIFICATIONS FOUND FOR USER ${userId} ⚠️ ⚠️ ⚠️`);
        console.log(`⚠️ This is the CRITICAL ISSUE - userId from token doesn't match userId in notifications`);
        console.log(`⚠️ Checking first 10 notifications in detail:`);
        
        allNotifications.slice(0, 10).forEach((n, idx) => {
          const nUserIdStr = n.userId?.toString ? n.userId.toString() : String(n.userId);
          const nUserIdObj = n.userId instanceof mongoose.default.Types.ObjectId 
            ? n.userId 
            : (mongoose.default.Types.ObjectId.isValid(n.userId) ? new mongoose.default.Types.ObjectId(n.userId) : null);
          
          const exactMatch = nUserIdStr === userIdStr;
          const stringMatch = nUserIdStr === userId;
          const hexMatch = nUserIdStr === userIdHex;
          const normalizedMatch = nUserIdStr === userIdNormalized;
          const objectIdEquals = nUserIdObj && nUserIdObj.equals ? nUserIdObj.equals(userIdObjectId) : false;
          const reverseEquals = nUserIdObj && userIdObjectId.equals ? userIdObjectId.equals(nUserIdObj) : false;
          
          console.log(`  🔴 Notification ${idx + 1}:`, {
            _id: n._id,
            storedUserId: nUserIdStr,
            storedUserIdType: typeof n.userId,
            storedUserIdIsObjectId: n.userId instanceof mongoose.default.Types.ObjectId,
            queryUserId: userIdStr,
            queryUserIdString: userId,
            queryUserIdHex: userIdHex,
            queryUserIdNormalized: userIdNormalized,
            exactMatch,
            stringMatch,
            hexMatch,
            normalizedMatch,
            objectIdEquals,
            reverseEquals,
            anyMatch: exactMatch || stringMatch || hexMatch || normalizedMatch || objectIdEquals || reverseEquals,
            type: n.type,
            title: n.title,
            timestamp: n.timestamp,
            // Character-by-character comparison for debugging
            storedChars: nUserIdStr.split(''),
            queryChars: userIdStr.split(''),
            charDiff: nUserIdStr.split('').map((char, i) => char !== userIdStr[i] ? `[${i}]: '${char}' vs '${userIdStr[i]}'` : null).filter(Boolean),
          });
        });
        
        // Also check if there are notifications with similar userIds (maybe case/whitespace issue)
        console.log(`⚠️ Searching for similar userIds...`);
        const similarUserIds = allNotifications.filter(n => {
          const nUserIdStr = n.userId?.toString ? n.userId.toString() : String(n.userId);
          // Check if userIds are similar (same length, similar characters)
          return nUserIdStr.length === userIdStr.length || 
                 nUserIdStr.toLowerCase().includes(userIdStr.toLowerCase()) ||
                 userIdStr.toLowerCase().includes(nUserIdStr.toLowerCase());
        }).slice(0, 5);
        
        if (similarUserIds.length > 0) {
          console.log(`⚠️ Found ${similarUserIds.length} notifications with similar userIds:`, 
            similarUserIds.map(n => ({
              _id: n._id,
              storedUserId: n.userId?.toString ? n.userId.toString() : String(n.userId),
              queryUserId: userIdStr,
              type: n.type,
              title: n.title,
            }))
          );
        }
      }
      
      // Log sample of filtered notifications for debugging
      if (filtered.length > 0) {
        console.log(`✅ Found matching notifications! Sample:`, {
          _id: filtered[0]._id,
          userId: filtered[0].userId?.toString(),
          userIdType: typeof filtered[0].userId,
          type: filtered[0].type,
          title: filtered[0].title,
        });
      }
      
      // Apply pagination only if we have filtered results
      if (filtered.length > 0) {
        totalCount = filtered.length;
        unreadCount = filtered.filter(n => !n.read).length;
        notifications = filtered.slice(parseInt(skip), parseInt(skip) + parseInt(limit));
        
        console.log(`📊 Final results: ${notifications.length} returned, ${unreadCount} unread, ${totalCount} total`);
      } else {
        // If in-memory filter found nothing, try direct MongoDB query as absolute last resort
        console.log(`⚠️ In-memory filter found 0 matches, trying direct MongoDB query...`);
        try {
          const directQueryResults = await Notification.find({
            $or: [
              { userId: userId },
              { userId: userIdObjectId },
              { userId: userIdObjectId.toString() },
              { userId: new mongoose.default.Types.ObjectId(userId) }, // Try creating new ObjectId from string
            ]
          })
            .sort({ timestamp: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(skip))
            .lean();
          
          if (directQueryResults.length > 0) {
            console.log(`✅ Direct MongoDB query found ${directQueryResults.length} notifications!`);
            notifications = directQueryResults;
            totalCount = await Notification.countDocuments({
              $or: [
                { userId: userId },
                { userId: userIdObjectId },
                { userId: userIdObjectId.toString() },
              ]
            });
            unreadCount = await Notification.countDocuments({
              $or: [
                { userId: userId },
                { userId: userIdObjectId },
                { userId: userIdObjectId.toString() },
              ],
              read: false,
            });
            console.log(`📊 Using direct query results: ${notifications.length} returned, ${unreadCount} unread, ${totalCount} total`);
          } else {
            console.log(`⚠️ Direct MongoDB query also found 0 notifications`);
            totalCount = 0;
            unreadCount = 0;
            notifications = [];
          }
        } catch (directQueryError) {
          console.error(`❌ Direct query failed:`, directQueryError);
          totalCount = 0;
          unreadCount = 0;
          notifications = [];
        }
      }
    } else {
      console.log(`⚠️ No notifications exist in database`);
    }



    res.json({
      notifications,
      unreadCount,
      total: totalCount,
      returned: notifications.length,
    });
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    res.status(500).json({ 
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
});

// POST /api/notifications - Create a new notification
router.post("/", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const {
      type,
      title,
      message,
      data,
      actionBy,
      loanInfo,
      notificationId,
      timestamp,
    } = req.body;

    // Check if notification with same notificationId already exists (deduplication)
    if (notificationId) {
      const existing = await Notification.findOne({
        userId,
        notificationId,
      });

      if (existing) {
        console.log("⚠️ Duplicate notification detected, skipping:", notificationId);
        return res.json({
          message: "Notification already exists",
          notification: existing,
        });
      }
    }

    const notification = new Notification({
      userId,
      type: type || "info",
      title: title || "Notification",
      message: message || "You have a new notification",
      read: false,
      timestamp: timestamp || new Date(),
      data,
      actionBy,
      loanInfo,
      notificationId: notificationId || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    await notification.save();

    res.status(201).json({
      message: "Notification created successfully",
      notification,
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ message: "Failed to create notification" });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put("/:id/read", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({
      message: "Notification marked as read",
      notification,
    });
  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ message: "Failed to update notification" });
  }
});

// PUT /api/notifications/read-all - Mark all notifications as read
router.put("/read-all", auth, async (req, res) => {
  try {
    const userId = req.user.sub;

    const result = await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );

    res.json({
      message: "All notifications marked as read",
      updatedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error marking all as read:", error);
    res.status(500).json({ message: "Failed to mark all as read" });
  }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete("/:id", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const notification = await Notification.findOneAndDelete({
      _id: id,
      userId,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({
      message: "Notification deleted successfully",
      id: notification._id,
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ message: "Failed to delete notification" });
  }
});

// DELETE /api/notifications - Delete all notifications
router.delete("/", auth, async (req, res) => {
  try {
    const userId = req.user.sub;

    const result = await Notification.deleteMany({ userId });

    res.json({
      message: "All notifications deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting all notifications:", error);
    res.status(500).json({ message: "Failed to delete all notifications" });
  }
});

// GET /api/notifications/unread-count - Get unread count
router.get("/unread-count", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    // Ensure userId is ObjectId
    const mongoose = await import("mongoose");
    const userIdObjectId = mongoose.default.Types.ObjectId.isValid(userId) 
      ? (typeof userId === 'string' ? new mongoose.default.Types.ObjectId(userId) : userId)
      : null;

    if (!userIdObjectId) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    const unreadCount = await Notification.countDocuments({
      userId: userIdObjectId,
      read: false,
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ message: "Failed to fetch unread count" });
  }
});

// GET /api/notifications/test - Test endpoint to verify notifications are being saved
router.get("/test", auth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const mongoose = await import("mongoose");
    
    // Ensure userId is ObjectId
    const userIdObjectId = mongoose.default.Types.ObjectId.isValid(userId) 
      ? (typeof userId === 'string' ? new mongoose.default.Types.ObjectId(userId) : userId)
      : null;

    if (!userIdObjectId) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    // Try multiple query formats
    const query1 = await Notification.countDocuments({ userId: userIdObjectId });
    const query2 = await Notification.countDocuments({ userId: userId });
    const query3 = await Notification.countDocuments({ userId: userIdObjectId.toString() });
    const query4 = await Notification.countDocuments({
      $or: [
        { userId: userIdObjectId },
        { userId: userId },
        { userId: userIdObjectId.toString() },
      ]
    });

    // Get latest 5 notifications with flexible query
    const latest = await Notification.find({
      $or: [
        { userId: userIdObjectId },
        { userId: userId },
        { userId: userIdObjectId.toString() },
      ]
    })
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();

    // Get all notifications to see userId formats
    const allSample = await Notification.find({}).limit(10).select('userId').lean();

    res.json({
      userFromToken: {
        userId: userId,
        userIdType: typeof userId,
        userIdObjectId: userIdObjectId.toString(),
      },
      queryResults: {
        withObjectId: query1,
        withString: query2,
        withStringConverted: query3,
        withFlexibleQuery: query4,
      },
      totalCount: query4,
      unreadCount: await Notification.countDocuments({
        $or: [
          { userId: userIdObjectId },
          { userId: userId },
          { userId: userIdObjectId.toString() },
        ],
        read: false,
      }),
      latest: latest.map(n => ({
        _id: n._id,
        userId: n.userId?.toString(),
        userIdType: typeof n.userId,
        type: n.type,
        title: n.title,
        read: n.read,
        timestamp: n.timestamp,
        notificationId: n.notificationId,
      })),
      sampleUserIdsInDB: allSample.map(n => ({
        userId: n.userId?.toString(),
        userIdType: typeof n.userId,
        matches: n.userId?.toString() === userIdObjectId.toString(),
      })),
      message: "Test endpoint - check query results",
    });
  } catch (error) {
    console.error("Error in test endpoint:", error);
    res.status(500).json({ 
      message: "Test failed",
      error: error.message,
    });
  }
});

export default router;
