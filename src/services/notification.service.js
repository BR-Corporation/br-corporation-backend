const Notification = require("../models/notification.model");
const User = require("../models/user.model");
const CustomerProfile = require("../models/customerProfile.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildNotification,
    buildNotificationList,
    buildNotificationSummary
} = require("../dto/notification.dto");

// ----------------------------
// Create Notification
// ----------------------------

const createNotification = async (notificationData) => {

    const {
        recipient,
        type,
        title,
        message,
        referenceEntity,
        referenceId
    } = notificationData;

    const notification = await Notification.create({

        recipient,

        type,

        title,

        message,

        referenceEntity,

        referenceId

    });

    await notification.populate({

        path: "recipient",

        select: "Name email role"

    });

    return buildNotification(notification);

};

// ----------------------------
// Get User Notifications
// ----------------------------

const getUserNotifications = async (userId, query = {}) => {

    const { page = 1, limit = 10, isRead, sort = "-createdAt" } = query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const filter = { recipient: userId };

    if (isRead !== undefined) {
        filter.isRead = isRead;
    }

    const totalNotifications = await Notification.countDocuments(filter);

    const notifications = await Notification.find(filter)

        .populate({ path: "recipient", select: "Name email" })

        .sort(sort)

        .skip(skip)

        .limit(limitNumber);

    return {

        success: true,

        page: pageNumber,

        limit: limitNumber,

        totalNotifications,

        totalPages: Math.ceil(totalNotifications / limitNumber),

        notifications: buildNotificationList(notifications)

    };

};

// ----------------------------
// Get Notification Summary
// ----------------------------

const getNotificationSummary = async (userId) => {

    const totalNotifications = await Notification.countDocuments({ recipient: userId });

    const unreadNotifications = await Notification.countDocuments({

        recipient: userId,

        isRead: false

    });

    const readNotifications = totalNotifications - unreadNotifications;

    return buildNotificationSummary({

        total: totalNotifications,

        unread: unreadNotifications,

        read: readNotifications

    });

};

// ----------------------------
// Mark Notification as Read
// ----------------------------

const markNotificationAsRead = async (notificationId, userId) => {

    const notification = await Notification.findById(notificationId);

    if (!notification) {

        throw new BusinessError("Notification not found.", 404);

    }

    if (notification.recipient.toString() !== userId.toString()) {

        throw new BusinessError("You are not authorized to access this notification.", 403);

    }

    notification.markAsRead();

    await notification.save();

    await notification.populate({

        path: "recipient",

        select: "Name email"

    });

    return buildNotification(notification);

};

// ----------------------------
// Mark All Notifications as Read
// ----------------------------

const markAllNotificationsAsRead = async (userId) => {

    await Notification.updateMany(

        { recipient: userId, isRead: false },

        { isRead: true }

    );

    return {

        success: true,

        message: "All notifications marked as read."

    };

};

/**
 * Send the same notification to every approved customer.
 */
const notifyAllApprovedCustomers = async ({ type, title, message, referenceEntity, referenceId }) => {
    try {
        const customers = await User.find({ role: "customer", status: "approved" }).select("_id");
        for (const u of customers) {
            await createNotification({
                recipient: u._id,
                type,
                title,
                message,
                referenceEntity,
                referenceId
            });
        }
    } catch (e) {
        console.error("notifyAllApprovedCustomers failed:", e.message);
    }
};

/**
 * Send the same notification to every active admin.
 * Failures are swallowed so caller flow (order creation, etc.) isn't broken.
 */
const notifyAllAdmins = async ({ type, title, message, referenceEntity, referenceId }) => {
    try {
        const admins = await User.find({ role: "admin", status: { $ne: "suspended" } }).select("_id");
        for (const a of admins) {
            await createNotification({
                recipient: a._id,
                type,
                title,
                message,
                referenceEntity,
                referenceId
            });
        }
    } catch (e) {
        console.error("notifyAllAdmins failed:", e.message);
    }
};

module.exports = {

    createNotification,

    notifyAllAdmins,

    notifyAllApprovedCustomers,

    getUserNotifications,

    getNotificationSummary,

    markNotificationAsRead,

    markAllNotificationsAsRead

};
