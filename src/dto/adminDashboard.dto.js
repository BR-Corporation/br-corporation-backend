// ----------------------------
// Admin Dashboard DTO
// ----------------------------

const buildAdminDashboard = (dashboard) => {

    if (!dashboard) return null;

    return {

        customers: {

            total: dashboard.totalCustomers,

            new: dashboard.newCustomers,

            active: dashboard.activeCustomers,

            pending: dashboard.pendingCustomers,

            byStage: dashboard.customersByStage,

            byCity: dashboard.customersByCity

        },

        sales: {

            totalSales: dashboard.totalSales,

            dailySales: dashboard.dailySales,

            monthlySales: dashboard.monthlySales,

            salesTrends: dashboard.salesTrends,

            totalOrders: dashboard.totalOrders,

            averageOrderValue: dashboard.averageOrderValue

        },

        salespersonPerformance: {

            ranking: dashboard.salespersonRanking,

            sales: dashboard.salespersonSales,

            orders: dashboard.salespersonOrders,

            quotations: dashboard.salespersonQuotations,

            conversionRate: dashboard.salespersonConversionRate,

            followUpPerformance: dashboard.salespersonFollowUpPerformance

        },

        managerPerformance: {

            teamSales: dashboard.managerTeamSales,

            teamConversion: dashboard.managerTeamConversion,

            teamPerformance: dashboard.managerTeamPerformance

        },

        inventory: {

            totalProducts: dashboard.totalProducts,

            lowStockProducts: dashboard.lowStockProducts,

            outOfStockProducts: dashboard.outOfStockProducts,

            stockMovements: dashboard.stockMovements,

            bestSellingProducts: dashboard.bestSellingProducts

        },

        finance: {

            totalRevenue: dashboard.totalRevenue,

            totalSales: dashboard.totalSales,

            returnedAmount: dashboard.returnedAmount,

            refundsIssued: dashboard.refundsIssued,

            refundPending: dashboard.refundPending,

            paymentsCollected: dashboard.paymentsCollected,

            outstandingAmount: dashboard.outstandingAmount,

            overduePayments: dashboard.overduePayments

        },

        quotations: {

            created: dashboard.totalQuotations,

            sent: dashboard.sentQuotations,

            accepted: dashboard.acceptedQuotations,

            rejected: dashboard.rejectedQuotations,

            conversionRate: dashboard.quotationConversionRate

        },

        customerCRM: {

            followUps: dashboard.totalFollowUps,

            overdueFollowUps: dashboard.overdueFollowUps,

            stageDistribution: dashboard.customerStageDistribution

        }

    };

};

module.exports = {

    buildAdminDashboard

};
