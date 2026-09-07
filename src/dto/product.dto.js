// ----------------------------
// Product Summary DTO
// ----------------------------

const buildProductSummary = (product) => {

    if (!product) return null;

    const stockStatus = product.stock === 0 ? 'out_of_stock' :
                        product.stock <= product.minimumStock ? 'low_stock' : 'in_stock';

    return {

        id: product._id,

        name: product.name,

        SKU: product.SKU,

        category: product.category,

        sellingPrice: product.sellingPrice,

        tax: product.tax,

        unit: product.unit,

        stock: product.stock,

        minimumStock: product.minimumStock,

        status: product.status,

        stockStatus,

        image: product.image,

        createdAt: product.createdAt,

        updatedAt: product.updatedAt

    };

};

// ----------------------------
// Product Detail DTO
// ----------------------------

const buildProductDetail = (product) => {

    if (!product) return null;

    const stockStatus = product.stock === 0 ? 'out_of_stock' :
                        product.stock <= product.minimumStock ? 'low_stock' : 'in_stock';

    return {

        id: product._id,

        name: product.name,

        SKU: product.SKU,

        category: product.category,

        description: product.description,

        sellingPrice: product.sellingPrice,

        costPrice: product.costPrice,

        tax: product.tax,

        unit: product.unit,

        stock: product.stock,

        minimumStock: product.minimumStock,

        status: product.status,

        stockStatus,

        image: product.image,

        createdBy: product.createdBy,

        updatedBy: product.updatedBy,

        createdAt: product.createdAt,

        updatedAt: product.updatedAt

    };

};

// ----------------------------
// Product List DTO
// ----------------------------

const buildProductList = (products = []) => {

    return products.map(buildProductSummary);

};

module.exports = {

    buildProductSummary,

    buildProductDetail,

    buildProductList

};
