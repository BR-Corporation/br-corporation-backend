const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
    {

        customerProfile: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CustomerProfile",
            required: true
        },

        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            required: true
        },

        amount: {
            type: Number,
            required: [true, "Payment amount is required."],
            min: [0.01, "Payment amount must be greater than 0."]
        },

        paymentMethod: {
            type: String,
            enum: ["cash", "bank_transfer", "upi", "cheque", "card", "other"],
            required: [true, "Payment method is required."]
        },

        // "payment" = money in (customer pays us).
        // "refund"  = money out (we return money after a return/cancel).
        // Amount stays positive; aggregations subtract refunds.
        type: {
            type: String,
            enum: ["payment", "refund"],
            default: "payment",
            index: true
        },

        orderReturn: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "OrderReturn",
            default: null
        },

        paymentDate: {
            type: Date,
            required: [true, "Payment date is required."],
            default: Date.now
        },

        transactionReference: {
            type: String,
            trim: true,
            maxlength: [100, "Transaction reference must not exceed 100 characters."]
        },

        notes: {
            type: String,
            trim: true,
            maxlength: [500, "Notes must not exceed 500 characters."]
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }

    },
    {
        timestamps: true,
        versionKey: false
    }
);

// ---------------- Indexes ----------------

paymentSchema.index({ customerProfile: 1, createdAt: -1 });
paymentSchema.index({ order: 1, createdAt: -1 });
paymentSchema.index({ paymentMethod: 1 });
paymentSchema.index({ paymentDate: 1 });
paymentSchema.index({ createdBy: 1 });

// ---------------- Instance Methods ----------------

paymentSchema.methods.isCash = function () {
    return this.paymentMethod === "cash";
};

paymentSchema.methods.isBankTransfer = function () {
    return this.paymentMethod === "bank_transfer";
};

paymentSchema.methods.isUpi = function () {
    return this.paymentMethod === "upi";
};

paymentSchema.methods.isCheque = function () {
    return this.paymentMethod === "cheque";
};

paymentSchema.methods.isCard = function () {
    return this.paymentMethod === "card";
};

module.exports = mongoose.model("Payment", paymentSchema);
