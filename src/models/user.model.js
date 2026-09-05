const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
    {
        Name: {
            type: String,
            required: [true, "Name is required."],
            trim: true
        },

        phoneNumber: {
            type: String,
            required: [true, "Phone Number is required."],
            unique: true,
            trim: true,
            match: [
                /^[6-9]\d{9}$/,
                "Please enter a valid Indian mobile number."
            ]
        },

        email: {
            type: String,
            trim: true,
            lowercase: true,
            unique: true,
            sparse: true,
            required: function () {
                return this.role !== "customer";
            },
            match: [
                /^\S+@\S+\.\S+$/,
                "Please enter a valid email address."
            ]
        },

        password: {
            type: String,
            select: false,
            required: function () {
                return this.role !== "customer";
            }
        },

        role: {
            type: String,
            enum: [
                "customer",
                "salesperson",
                "manager",
                "admin"
            ],
            required: true
        },

        managerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        status: {
            type: String,
            enum: [
                "pending",
                "approved",
                "suspended"
            ],
            default: function () {
                return this.role === "customer"
                    ? "pending"
                    : "approved";
            }
        },

        mustChangePassword: {
            type: Boolean,
            default: function () {
                return this.role !== "customer";
            }
        },

        otpVerified: {
            type: Boolean,
            default: false
        },

        otpBypass: {
            type: Boolean,
            default: false
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        }
    },
    {
        timestamps: true,
        versionKey: false,

        toJSON: {
            virtuals: true,
            transform(doc, ret) {
                delete ret.password;
                return ret;
            }
        }
    }
);

// ---------------- Hooks ----------------

userSchema.pre("save", async function () {

    if (!this.isModified("password")) {
        return;
    }

    this.password = await bcrypt.hash(this.password, 12);

});

// ---------------- Instance Methods ----------------

userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isEmployee = function () {
    return this.role !== "customer";
};

userSchema.methods.isCustomer = function () {
    return this.role === "customer";
};

userSchema.methods.isApproved = function () {
    return this.status === "approved";
};

userSchema.methods.shouldChangePassword = function () {
    return this.mustChangePassword;
};

// ---------------- Static Methods ----------------

userSchema.statics.findPendingCustomers = function () {
    return this.find({
        role: "customer",
        status: "pending"
    });
};

userSchema.statics.findEmployees = function () {
    return this.find({
        role: {
            $in: [
                "admin",
                "manager",
                "salesperson"
            ]
        }
    });
};

userSchema.statics.findByPhoneNumber = function (phoneNumber) {
    return this.findOne({ phoneNumber });
};

userSchema.statics.findByEmail = function (email) {
    return this.findOne({ email });
};

// ---------------- Indexes ----------------

userSchema.index({
    role: 1,
    status: 1
});

module.exports = mongoose.model("User", userSchema);