const Message = require("../models/message.model");
const User = require("../models/user.model");
const CustomerProfile = require("../models/customerProfile.model");
const BusinessError = require("../utils/errors/businessError");
const { createNotification } = require("./notification.service");

/**
 * Enforce who-can-message-whom.
 * A customer can only message their assigned salesperson.
 * A salesperson can only message a customer assigned to them.
 * Admin / manager can message anyone (used sparingly).
 */
const assertRelationship = async (fromUser, toUserId) => {
    const toUser = await User.findById(toUserId);
    if (!toUser) throw new BusinessError("Recipient not found.", 404);

    if (fromUser.role === "customer") {
        const profile = await CustomerProfile.findOne({ user: fromUser._id });
        if (!profile) throw new BusinessError("Customer profile missing.", 404);
        if (!profile.assignedSalesperson ||
            profile.assignedSalesperson.toString() !== toUser._id.toString()) {
            throw new BusinessError("You can only message your assigned salesperson.", 403);
        }
    } else if (fromUser.role === "salesperson") {
        if (toUser.role !== "customer") {
            throw new BusinessError("Salesperson can only message customers.", 403);
        }
        const profile = await CustomerProfile.findOne({ user: toUser._id });
        if (!profile ||
            !profile.assignedSalesperson ||
            profile.assignedSalesperson.toString() !== fromUser._id.toString()) {
            throw new BusinessError("This customer is not assigned to you.", 403);
        }
    }
    // admin / manager: no restriction
    return toUser;
};

const sendMessage = async ({ from, toUserId, text }) => {
    if (!text || !text.trim()) throw new BusinessError("Message cannot be empty.", 400);
    if (text.length > 2000) throw new BusinessError("Message too long.", 400);

    await assertRelationship(from, toUserId);

    const msg = await Message.create({
        from: from._id,
        to: toUserId,
        text: text.trim(),
    });

    // fire-and-forget notification
    try {
        await createNotification({
            recipient: toUserId,
            type: "message_received",
            title: `New message from ${from.Name || "your contact"}`,
            message: text.length > 80 ? text.slice(0, 80) + "…" : text,
            referenceEntity: "Message",
            referenceId: msg._id,
        });
    } catch (_) { /* non-fatal */ }

    return {
        id: msg._id,
        from: msg.from,
        to: msg.to,
        text: msg.text,
        createdAt: msg.createdAt,
        readAt: msg.readAt,
    };
};

/**
 * Get the full message thread between the logged-in user and another user.
 * Also marks the other-party's messages as read.
 */
const getThread = async (currentUser, otherUserId) => {
    await assertRelationship(currentUser, otherUserId);

    const messages = await Message.find({
        $or: [
            { from: currentUser._id, to: otherUserId },
            { from: otherUserId, to: currentUser._id },
        ],
    })
        .sort("createdAt")
        .limit(500);

    // mark unread messages TO me as read
    await Message.updateMany(
        { from: otherUserId, to: currentUser._id, readAt: null },
        { $set: { readAt: new Date() } }
    );

    const other = await User.findById(otherUserId).select("Name role phoneNumber email");
    return {
        success: true,
        other: other ? { id: other._id, Name: other.Name, role: other.role, phoneNumber: other.phoneNumber, email: other.email } : null,
        messages: messages.map((m) => ({
            id: m._id,
            from: m.from,
            to: m.to,
            text: m.text,
            mine: m.from.toString() === currentUser._id.toString(),
            createdAt: m.createdAt,
            readAt: m.readAt,
        })),
    };
};

/**
 * List all threads the current user has (unique other-party + last message + unread count).
 * For a customer: usually one thread (their assigned salesperson).
 * For a salesperson: one thread per assigned customer.
 */
const listThreads = async (currentUser) => {
    const msgs = await Message.find({
        $or: [{ from: currentUser._id }, { to: currentUser._id }],
    })
        .sort("-createdAt")
        .limit(1000)
        .lean();

    const otherMap = new Map();
    for (const m of msgs) {
        const otherId = m.from.toString() === currentUser._id.toString()
            ? m.to.toString()
            : m.from.toString();
        if (!otherMap.has(otherId)) {
            otherMap.set(otherId, { lastMessage: m, unread: 0 });
        }
        const entry = otherMap.get(otherId);
        if (m.to.toString() === currentUser._id.toString() && !m.readAt) entry.unread += 1;
    }

    const otherIds = Array.from(otherMap.keys());
    const users = otherIds.length
        ? await User.find({ _id: { $in: otherIds } }).select("Name role")
        : [];
    const userById = new Map(users.map((u) => [u._id.toString(), u]));

    return {
        success: true,
        threads: Array.from(otherMap.entries()).map(([otherId, { lastMessage, unread }]) => ({
            otherUserId: otherId,
            otherName: userById.get(otherId)?.Name || "Unknown",
            otherRole: userById.get(otherId)?.role || null,
            lastMessage: {
                text: lastMessage.text,
                createdAt: lastMessage.createdAt,
                mine: lastMessage.from.toString() === currentUser._id.toString(),
            },
            unread,
        })).sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt)),
    };
};

module.exports = { sendMessage, getThread, listThreads };
