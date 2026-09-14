const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        from: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        to: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        // The user this message is grouped under (customer <-> salesperson thread).
        // 99% of the time this equals `from`, but when admin sends into a
        // customer/salesperson thread we store `from = salesperson` and
        // `authorId = admin` so the message shows in-line in the same
        // customer↔salesperson window with a "via admin" chip.
        authorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        text: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000,
        },
        readAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true, versionKey: false }
);

messageSchema.index({ from: 1, to: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
