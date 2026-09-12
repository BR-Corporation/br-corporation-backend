const Product = require("../models/product.model");
const InventoryMovement = require("../models/inventoryMovement.model");
const Order = require("../models/order.model");
const Quotation = require("../models/quotation.model");
const User = require("../models/user.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildProductSummary,
    buildProductDetail,
    buildProductList
} = require("../dto/product.dto");

const {
    buildInventoryMovement,
    buildInventoryMovementList
} = require("../dto/inventoryMovement.dto");

const {
    createNotification
} = require("./notification.service");

const fs = require("fs");
const path = require("path");

const PRODUCT_UPLOAD_DIR = path.join(__dirname, "../../uploads/products");

const resolveImagePath = (imageFile) => {
    if (!imageFile) return null;
    if (imageFile.cloudinaryUrl) return imageFile.cloudinaryUrl;
    // Guard against missing filename (e.g. memory storage without Cloudinary configured)
    if (!imageFile.filename) return null;
    return path.join("uploads/products", imageFile.filename).replace(/\\/g, "/");
};

const deleteProductImage = (imagePath) => {

    if (!imagePath) return;

    if (/^https?:\/\//i.test(imagePath)) return;

    const fullPath = path.join(__dirname, "../../", imagePath);

    if (fs.existsSync(fullPath)) {

        fs.unlinkSync(fullPath);

    }

};

// ----------------------------
// Create Product
// ----------------------------

const createProduct = async (productData, loggedInUser, imageFile) => {

    const existingSKU = await Product.findOne({ SKU: productData.SKU });

    if (existingSKU) {

        throw new BusinessError("Product with this SKU already exists.", 409);

    }

    const imagePath = resolveImagePath(imageFile);

    const product = await Product.create({

        ...productData,

        image: imagePath,

        createdBy: loggedInUser._id,

        updatedBy: loggedInUser._id

    });

    await product.populate([

        { path: "createdBy", select: "Name email" },

        { path: "updatedBy", select: "Name email" }

    ]);

    return buildProductDetail(product);

};

// ----------------------------
// Get Products
// ----------------------------

const getProducts = async (query) => {

    const {

        page = 1,

        limit = 10,

        category,

        status,

        stockStatus,

        sort = "-createdAt"

    } = query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const skip = (pageNumber - 1) * limitNumber;

    const filter = {};

    if (category) {
        filter.category = category;
    }

    if (status) {
        filter.status = status;
    }

    let products;

    if (stockStatus === "low_stock") {

        products = await Product.find({ ...filter, status: "active" })

            .populate({ path: "createdBy", select: "Name email" })

            .populate({ path: "updatedBy", select: "Name email" })

            .sort(sort)

            .skip(skip)

            .limit(limitNumber);

        products = products.filter(p => p.stock <= p.minimumStock && p.stock > 0);

    } else if (stockStatus === "out_of_stock") {

        products = await Product.find({ ...filter, stock: 0, status: "active" })

            .populate({ path: "createdBy", select: "Name email" })

            .populate({ path: "updatedBy", select: "Name email" })

            .sort(sort)

            .skip(skip)

            .limit(limitNumber);

    } else if (stockStatus === "in_stock") {

        products = await Product.find({ ...filter, status: "active" })

            .populate({ path: "createdBy", select: "Name email" })

            .populate({ path: "updatedBy", select: "Name email" })

            .sort(sort)

            .skip(skip)

            .limit(limitNumber);

        products = products.filter(p => p.stock > p.minimumStock);

    } else {

        products = await Product.find(filter)

            .populate({ path: "createdBy", select: "Name email" })

            .populate({ path: "updatedBy", select: "Name email" })

            .sort(sort)

            .skip(skip)

            .limit(limitNumber);

    }

    return {

        page: pageNumber,

        limit: limitNumber,

        totalProducts: products.length,

        totalPages: Math.ceil(products.length / limitNumber),

        products: buildProductList(products)

    };

};

// ----------------------------
// Get Product By ID
// ----------------------------

const getProductById = async (productId) => {

    const product = await Product.findById(productId)

        .populate({ path: "createdBy", select: "Name email" })

        .populate({ path: "updatedBy", select: "Name email" });

    if (!product) {

        throw new BusinessError("Product not found.", 404);

    }

    return buildProductDetail(product);

};

// ----------------------------
// Update Product
// ----------------------------

const updateProduct = async (productId, updateData, loggedInUser, imageFile) => {

    const product = await Product.findById(productId);

    if (!product) {

        throw new BusinessError("Product not found.", 404);

    }

    if (updateData.SKU && updateData.SKU !== product.SKU) {

        const existingSKU = await Product.findOne({ SKU: updateData.SKU });

        if (existingSKU) {

            throw new BusinessError("Product with this SKU already exists.", 409);

        }

    }

    if (imageFile) {

        if (product.image) {

            deleteProductImage(product.image);

        }

        updateData.image = resolveImagePath(imageFile);

    }

    Object.assign(product, updateData, { updatedBy: loggedInUser._id });

    await product.save();

    await product.populate([

        { path: "createdBy", select: "Name email" },

        { path: "updatedBy", select: "Name email" }

    ]);

    await notifyIfLowStock(product);

    return buildProductDetail(product);

};

const notifyIfLowStock = async (product) => {
    if (!product || typeof product.stock !== "number") return;
    if (product.stock > (product.minimumStock || 0)) return;

    try {
        const adminsAndManagers = await User.find({
            role: { $in: ["admin", "manager"] },
            status: { $ne: "suspended" }
        }).select("_id");

        const isOut = product.stock === 0;
        const title = isOut ? "Out of stock" : "Low stock alert";
        const message = isOut
            ? `Product ${product.name} (SKU: ${product.SKU}) is OUT OF STOCK.`
            : `Product ${product.name} (SKU: ${product.SKU}) is low. Stock: ${product.stock} / min: ${product.minimumStock}.`;

        for (const user of adminsAndManagers) {
            await createNotification({
                recipient: user._id,
                type: "low_stock",
                title,
                message,
                referenceEntity: "product",
                referenceId: product._id
            });
        }
    } catch (_) { /* notification failures shouldn't break stock flow */ }
};

// ----------------------------
// Adjust Stock (with Inventory Movement)
// ----------------------------

const adjustStock = async (productId, adjustmentData, loggedInUser) => {

    const { type, quantity, reason, reference } = adjustmentData;

    const product = await Product.findById(productId);

    if (!product) {

        throw new BusinessError("Product not found.", 404);

    }

    const previousStock = product.stock;

    let newStock = previousStock;

    if (type === "stock_in") {

        newStock = previousStock + quantity;

    } else if (type === "stock_out" || type === "damaged") {

        newStock = previousStock - quantity;

        if (newStock < 0) {

            throw new BusinessError("Stock cannot become negative.", 400);

        }

    } else if (type === "adjustment") {

        if (quantity > previousStock) {

            throw new BusinessError("Adjustment quantity cannot exceed current stock for this type.", 400);

        }

        newStock = previousStock - quantity;

    } else if (type === "returned") {

        newStock = previousStock + quantity;

    }

    product.stock = newStock;

    product.updatedBy = loggedInUser._id;

    await product.save();

    const movement = await InventoryMovement.create({

        product: product._id,

        type,

        quantity,

        previousStock,

        newStock,

        performedBy: loggedInUser._id,

        reason: reason || "",

        reference: reference || ""

    });

    await movement.populate({ path: "performedBy", select: "Name email" });

    if (newStock < previousStock) {
        await notifyIfLowStock(product);
    }

    return {

        success: true,

        message: "Stock adjusted successfully.",

        product: buildProductDetail(product),

        movement: buildInventoryMovement(movement)

    };

};

const updateProductStatus = async (productId, status, loggedInUser) => {
    if (!["active", "inactive"].includes(status)) {
        throw new BusinessError("Invalid product status.", 400);
    }
    const product = await Product.findById(productId);
    if (!product) {
        throw new BusinessError("Product not found.", 404);
    }
    if (product.status === status) {
        return { product: buildProductDetail(product), unchanged: true };
    }
    product.status = status;
    product.updatedBy = loggedInUser._id;
    await product.save();
    await product.populate([
        { path: "createdBy", select: "Name email" },
        { path: "updatedBy", select: "Name email" }
    ]);
    return { product: buildProductDetail(product) };
};

const deleteProduct = async (productId) => {
    const product = await Product.findById(productId);
    if (!product) {
        throw new BusinessError("Product not found.", 404);
    }

    const hasOrders = await Order.exists({ "items.product": productId });
    const hasQuotations = await Quotation.exists({ "items.product": productId });
    const hasMovements = await InventoryMovement.exists({ product: productId });

    if (hasOrders || hasQuotations || hasMovements) {
        if (product.status === "inactive") {
            return {
                alreadyDeactivated: true,
                message: "Product is already deactivated."
            };
        }
        product.status = "inactive";
        await product.save();
        return {
            deactivated: true,
            message: "Product has existing transactions and has been deactivated instead of deleted."
        };
    }

    if (product.image) {
        deleteProductImage(product.image);
    }

    await Product.findByIdAndDelete(productId);
    return {
        deleted: true,
        message: "Product deleted successfully."
    };
};

// ----------------------------
// Get Inventory Movements
// ----------------------------

const getInventoryMovements = async (productId) => {

    const product = await Product.findById(productId);

    if (!product) {

        throw new BusinessError("Product not found.", 404);

    }

    const movements = await InventoryMovement.find({ product: productId })
        .sort({ createdAt: -1 })
        .populate({ path: "performedBy", select: "Name role email" });

    return {

        success: true,

        productId: product._id,

        productName: product.name,

        productSKU: product.SKU,

        currentStock: product.stock,

        minimumStock: product.minimumStock,

        stockStatus: product.stockStatus,

        movements: buildInventoryMovementList(movements)

    };

};

module.exports = {

    createProduct,

    getProducts,

    getProductById,

    updateProduct,

    adjustStock,

    getInventoryMovements,

    deleteProduct,

    updateProductStatus,

    notifyIfLowStock

};
