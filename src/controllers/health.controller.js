const healthCheck = (req, res) => {

    res.status(200).json({

        success: true,

        message: "🚀 BR Corporation Backend is Running"

    });

};

module.exports = {

    healthCheck

};