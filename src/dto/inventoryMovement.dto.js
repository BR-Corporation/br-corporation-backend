// ----------------------------
// Inventory Movement DTO
// ----------------------------

const buildInventoryMovement = (movement) => {

    if (!movement) return null;

    // performedBy may be a populated User document OR a raw ObjectId
    const perf = movement.performedBy;
    const performedBy = perf && perf._id
        ? { id: perf._id, Name: perf.Name, role: perf.role, email: perf.email }
        : perf;

    return {

        id: movement._id,

        productId: movement.product,

        type: movement.type,

        quantity: movement.quantity,

        previousStock: movement.previousStock,

        newStock: movement.newStock,

        performedBy,

        reason: movement.reason,

        reference: movement.reference,

        createdAt: movement.createdAt,

        updatedAt: movement.updatedAt

    };

};

// ----------------------------
// Inventory Movement List DTO
// ----------------------------

const buildInventoryMovementList = (movements = []) => {

    return movements.map(buildInventoryMovement);

};

module.exports = {

    buildInventoryMovement,

    buildInventoryMovementList

};
