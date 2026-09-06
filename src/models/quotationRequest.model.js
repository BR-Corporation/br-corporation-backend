const mongoose = require("mongoose");

/**
 * Workflow:
 *   customer creates request → status: "pending_salesperson"
 *   salesperson forwards to manager → status: "pending_manager"
 *   manager (or admin) creates the actual Quotation → status: "quoted"
 *   customer accepts/rejects on the Quotation itself (existing flow)
 */
const requestedItemSchema = new mongoose.Schema(
    {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        productName: { type: String, required: true, trim: true },
        quantity: { type: Number, required: true, min: 1 },
        notes: { type: String, trim: true, maxlength: 300 },
    },
    { _id: true, versionKey: false }
);

const quotationRequestSchema = new mongoose.Schema(
    {
        customerProfile: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerProfile", required: true, index: true },
        salesperson: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        // set when salesperson forwards to a specific manager (or auto-assigned when a single manager exists)
        manager: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        items: {
            type: [requestedItemSchema],
            validate: { validator: (v) => v.length > 0, message: "At least one item required." },
        },
        notes: { type: String, trim: true, maxlength: 1000 },
        status: {
            type: String,
            enum: ["pending_salesperson", "pending_manager", "quoted", "rejected"],
            default: "pending_salesperson",
            index: true,
        },
        // link to the eventual Quotation once created
        quotation: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation", default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("QuotationRequest", quotationRequestSchema);
