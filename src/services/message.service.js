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

    const toUser = await User.findById(toUserId);
    if (!toUser) throw new BusinessError("Recipient not found.", 404);

    // If admin messages a customer, route the message into the customer's
    // existing salesperson thread instead of opening a separate admin chat.
    // The message is stored with from = salesperson so it shows up in the
    // same window; authorId = admin so the UI can show a "via Admin" chip.
    let effectiveFromId = from._id;
    let authorId = null;

    if (from.role === "admin" && toUser.role === "customer") {
        const profile = await CustomerProfile.findOne({ user: toUser._id });
        if (profile?.assignedSalesperson) {
            effectiveFromId = profile.assignedSalesperson;
            authorId = from._id;
        }
        // if no salesperson assigned yet, fall back to admin-as-from
    } else {
        // enforce the normal relationship rules for non-admin senders
        await assertRelationship(from, toUserId);
    }

    const msg = await Message.create({
        from: effectiveFromId,
        to: toUserId,
        authorId,
        text: text.trim(),
    });

    // fire-and-forget notification (to the recipient customer)
    try {
        await createNotification({
            recipient: toUserId,
            type: "message_received",
            title: authorId
                ? `New message from admin`
                : `New message from ${from.Name || "your contact"}`,
            message: text.length > 80 ? text.slice(0, 80) + "…" : text,
            referenceEntity: "message",
            referenceId: msg._id,
        });
    } catch (_) { /* non-fatal */ }

    return {
        id: msg._id,
        from: msg.from,
        to: msg.to,
        authorId: msg.authorId,
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
    // Admin can read any thread without being a party to it.
    if (currentUser.role !== "admin") {
        await assertRelationship(currentUser, otherUserId);
    }

    // For customers, merge any admin↔customer direct messages into the same
    // salesperson thread — so they see one window with "via admin" chips
    // inline, never a second tab for admin.
    let counterpartyIds = [otherUserId];
    if (currentUser.role === "customer") {
        const admins = await User.find({ role: "admin", status: { $ne: "suspended" } }).select("_id");
        counterpartyIds = Array.from(new Set([
            otherUserId.toString(),
            ...admins.map((a) => a._id.toString())
        ]));
    }

    const messages = await Message.find({
        $or: [
            { from: currentUser._id, to: { $in: counterpartyIds } },
            { from: { $in: counterpartyIds }, to: currentUser._id },
        ],
    })
        .sort("createdAt")
        .limit(500);

    // mark unread messages TO me as read
    await Message.updateMany(
        { from: { $in: counterpartyIds }, to: currentUser._id, readAt: null },
        { $set: { readAt: new Date() } }
    );

    // Load author names so the UI can render "via Admin" chips inline.
    // For legacy messages sent directly by admin with authorId=null, fall
    // back to the `from` user so their role still comes through.
    const idsForLookup = new Set();
    for (const m of messages) {
        if (m.authorId) idsForLookup.add(m.authorId.toString());
        else idsForLookup.add(m.from.toString());
    }
    const users = idsForLookup.size
        ? await User.find({ _id: { $in: Array.from(idsForLookup) } }).select("Name role")
        : [];
    const authorMap = new Map(users.map((u) => [u._id.toString(), u]));

    const other = await User.findById(otherUserId).select("Name role phoneNumber email");
    return {
        success: true,
        other: other ? { id: other._id, Name: other.Name, role: other.role, phoneNumber: other.phoneNumber, email: other.email } : null,
        messages: messages.map((m) => {
            // Determine "who really wrote this". authorId wins when set; else
            // fall back to `from` (covers legacy direct admin→customer msgs).
            const effectiveAuthorId = m.authorId ? m.authorId.toString() : m.from.toString();
            const author = authorMap.get(effectiveAuthorId) || null;
            const mine =
                m.from.toString() === currentUser._id.toString() ||
                m.authorId?.toString() === currentUser._id.toString();
            return {
                id: m._id,
                from: m.from,
                to: m.to,
                authorId: effectiveAuthorId,
                authorName: author?.Name || null,
                authorRole: author?.role || null,
                text: m.text,
                mine,
                createdAt: m.createdAt,
                readAt: m.readAt,
            };
        }),
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

    // Customer view: collapse every admin↔customer interaction into the
    // salesperson thread. If a message's other-party is admin (either
    // directly `from` an admin or `authorId` an admin), treat it as if it
    // were with the customer's assigned salesperson.
    let adminIdsSet = new Set();
    let mySalespersonId = null;
    if (currentUser.role === "customer") {
        const admins = await User.find({ role: "admin", status: { $ne: "suspended" } }).select("_id");
        adminIdsSet = new Set(admins.map((a) => a._id.toString()));
        const profile = await CustomerProfile.findOne({ user: currentUser._id }).select("assignedSalesperson");
        mySalespersonId = profile?.assignedSalesperson?.toString() || null;
    }

    const otherMap = new Map();
    for (const m of msgs) {
        let otherId = m.from.toString() === currentUser._id.toString()
            ? m.to.toString()
            : m.from.toString();
        if (adminIdsSet.has(otherId) && mySalespersonId) {
            otherId = mySalespersonId;
        }
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

/**
 * ADMIN OVERSIGHT: list every unique two-user conversation across the org,
 * with last message + total + unread-to-customer counts. Salesperson↔customer
 * pairs bubble up; admin↔anything also shows.
 */
const listAllConversations = async () => {
    const msgs = await Message.find({}).sort("-createdAt").limit(5000).lean();

    // Bucket by unordered pair "aId::bId" (sorted so both directions collapse into one row)
    const bucket = new Map();
    const userIds = new Set();
    for (const m of msgs) {
        const a = m.from.toString();
        const b = m.to.toString();
        userIds.add(a); userIds.add(b);
        const [x, y] = [a, b].sort();
        const key = `${x}::${y}`;
        if (!bucket.has(key)) bucket.set(key, { userA: x, userB: y, lastMessage: m, count: 0, unread: 0 });
        const entry = bucket.get(key);
        entry.count += 1;
        if (!m.readAt) entry.unread += 1;
    }

    const users = userIds.size
        ? await User.find({ _id: { $in: Array.from(userIds) } }).select("Name role")
        : [];
    const byId = new Map(users.map((u) => [u._id.toString(), u]));

    const conversations = Array.from(bucket.values()).map((c) => ({
        userA: { id: c.userA, Name: byId.get(c.userA)?.Name || "Unknown", role: byId.get(c.userA)?.role || null },
        userB: { id: c.userB, Name: byId.get(c.userB)?.Name || "Unknown", role: byId.get(c.userB)?.role || null },
        lastMessage: { text: c.lastMessage.text, createdAt: c.lastMessage.createdAt, fromId: c.lastMessage.from.toString() },
        totalMessages: c.count,
        unread: c.unread,
    })).sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));

    return { success: true, conversations };
};

/**
 * ADMIN: read any two-user thread — no relationship check.
 */
const getAnyThread = async (userAId, userBId) => {
    const messages = await Message.find({
        $or: [
            { from: userAId, to: userBId },
            { from: userBId, to: userAId },
        ],
    }).sort("createdAt").limit(1000);

    const users = await User.find({ _id: { $in: [userAId, userBId] } })
        .select("Name role phoneNumber email");
    const byId = new Map(users.map((u) => [u._id.toString(), u]));

    return {
        success: true,
        userA: byId.get(userAId) ? { id: userAId, ...byId.get(userAId).toObject() } : { id: userAId },
        userB: byId.get(userBId) ? { id: userBId, ...byId.get(userBId).toObject() } : { id: userBId },
        messages: messages.map((m) => ({
            id: m._id,
            from: m.from,
            to: m.to,
            text: m.text,
            createdAt: m.createdAt,
            readAt: m.readAt,
        })),
    };
};

/**
 * ADMIN: read a customer's entire conversation — messages between
 * customer↔salesperson AND customer↔any admin, merged chronologically.
 * This is the "look over the shoulder" view the admin uses to see
 * everything the customer has ever exchanged with the business.
 */
const getCustomerConversation = async (customerUserId) => {
    const customer = await User.findById(customerUserId).select("Name role phoneNumber email");
    if (!customer) throw new BusinessError("Customer not found.", 404);

    const profile = await CustomerProfile.findOne({ user: customerUserId }).select("assignedSalesperson businessName");
    const spId = profile?.assignedSalesperson?.toString() || null;

    const admins = await User.find({ role: "admin", status: { $ne: "suspended" } }).select("_id Name role");
    const adminIds = admins.map((a) => a._id.toString());

    const counterpartyIds = Array.from(new Set([
        ...(spId ? [spId] : []),
        ...adminIds,
    ]));

    if (counterpartyIds.length === 0) {
        return { success: true, customer, salesperson: null, messages: [] };
    }

    const messages = await Message.find({
        $or: [
            { from: customerUserId, to: { $in: counterpartyIds } },
            { from: { $in: counterpartyIds }, to: customerUserId },
        ],
    }).sort("createdAt").limit(500);

    const authorLookupIds = new Set();
    for (const m of messages) {
        if (m.authorId) authorLookupIds.add(m.authorId.toString());
        else authorLookupIds.add(m.from.toString());
    }
    const users = authorLookupIds.size
        ? await User.find({ _id: { $in: Array.from(authorLookupIds) } }).select("Name role")
        : [];
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const sp = spId ? await User.findById(spId).select("Name role") : null;

    return {
        success: true,
        customer: { id: customer._id, Name: customer.Name, role: customer.role, phoneNumber: customer.phoneNumber, email: customer.email, businessName: profile?.businessName },
        salesperson: sp ? { id: sp._id, Name: sp.Name, role: sp.role } : null,
        messages: messages.map((m) => {
            const effectiveAuthorId = m.authorId ? m.authorId.toString() : m.from.toString();
            const author = userMap.get(effectiveAuthorId) || null;
            return {
                id: m._id,
                from: m.from,
                to: m.to,
                authorId: effectiveAuthorId,
                authorName: author?.Name || null,
                authorRole: author?.role || null,
                text: m.text,
                createdAt: m.createdAt,
                readAt: m.readAt,
            };
        }),
    };
};

/**
 * Delete every message between the current user and the other party.
 * Customer: also clears any admin↔customer messages so their view is one thread.
 * Admin: clears the customer's full conversation (SP + all admins).
 * Other roles: clears only the direct pair.
 */
const clearThread = async (currentUser, otherUserId) => {
    const other = await User.findById(otherUserId);
    if (!other) throw new BusinessError("Recipient not found.", 404);

    let counterpartyIds = [otherUserId.toString()];

    if (currentUser.role === "admin") {
        // Admin clears the customer's full conversation.
        if (other.role !== "customer") {
            throw new BusinessError("Admin can only clear customer conversations.", 400);
        }
        const profile = await CustomerProfile.findOne({ user: otherUserId }).select("assignedSalesperson");
        const spId = profile?.assignedSalesperson?.toString();
        const admins = await User.find({ role: "admin" }).select("_id");
        const adminIds = admins.map((a) => a._id.toString());
        counterpartyIds = Array.from(new Set([...(spId ? [spId] : []), ...adminIds]));

        const result = await Message.deleteMany({
            $or: [
                { from: otherUserId, to: { $in: counterpartyIds } },
                { from: { $in: counterpartyIds }, to: otherUserId },
            ],
        });
        return { success: true, deleted: result.deletedCount || 0 };
    }

    if (currentUser.role === "customer") {
        const admins = await User.find({ role: "admin" }).select("_id");
        counterpartyIds = Array.from(new Set([
            otherUserId.toString(),
            ...admins.map((a) => a._id.toString()),
        ]));
    } else {
        // Salesperson / manager can only clear their own pair
        await assertRelationship(currentUser, otherUserId);
    }

    const result = await Message.deleteMany({
        $or: [
            { from: currentUser._id, to: { $in: counterpartyIds } },
            { from: { $in: counterpartyIds }, to: currentUser._id },
        ],
    });
    return { success: true, deleted: result.deletedCount || 0 };
};

module.exports = { sendMessage, getThread, listThreads, listAllConversations, getAnyThread, getCustomerConversation, clearThread };
