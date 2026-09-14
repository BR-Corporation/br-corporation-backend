const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {

        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        type: {
            type: String,
            enum: [
                // Quotations
                "quotation_created",
                "quotation_sent",
                "quotation_accepted",
                "quotation_rejected",
                "quotation_requested",
                // Follow-ups
                "follow_up_due",
                "follow_up_overdue",
                // Orders
                "order_created",
                "order_confirmed",
                "order_processing",
                "order_completed",
                "order_cancelled",
                // Payments
                "payment_received",
                "payment_overdue",
                "payment_refunded",
                // Inventory
                "low_stock",
                // Returns
                "return_created",
                "return_approved",
                "return_rejected",
                "return_completed",
                // Messaging
                "message_received",
                // Catalog
                "product_created"
            ],
            required: [true, "Notification type is required."]
        },

        title: {
            type: String,
            required: [true, "Notification title is required."],
            trim: true
        },

        message: {
            type: String,
            required: [true, "Notification message is required."],
            trim: true
        },

        isRead: {
            type: Boolean,
            default: false
        },

        referenceEntity: {
            type: String,
            enum: [
                "quotation", "quotationrequest",
                "order", "orderreturn",
                "payment",
                "follow_up",
                "product",
                "return",
                "message"
            ],
            required: true,
            // Normalize casing so callers can pass "Order" / "OrderReturn" / "QuotationRequest".
            set: (v) => typeof v === "string" ? v.toLowerCase() : v
        },

        referenceId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        }

    },
    {
        timestamps: true,
        versionKey: false
    }
);

// ---------------- Indexes ----------------

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ referenceEntity: 1, referenceId: 1 });

// ---------------- Instance Methods ----------------

notificationSchema.methods.isUnread = function () {
    return !this.isRead;
};

notificationSchema.methods.markAsRead = function () {
    this.isRead = true;
};

module.exports = mongoose.model("Notification", notificationSchema);
