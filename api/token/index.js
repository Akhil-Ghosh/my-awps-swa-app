// api/token/index.js

const { WebPubSubServiceClient } = require("@azure/web-pubsub");
require('dotenv').config();

/**
 * Azure Function to generate a Web PubSub client access token.
 * 
 * Query Parameters:
 * - userId: Unique identifier for the user.
 * 
 * Returns:
 * - JSON object containing the WebSocket URL.
 */
module.exports = async function (context, req) {
    context.log('Generating Web PubSub client access token.');

    const userId = req.query.userId;

    if (!userId) {
        context.res = {
            status: 400,
            body: "Missing userId parameter."
        };
        return;
    }

    try {
        const serviceClient = new WebPubSubServiceClient(
            process.env.AZURE_WEB_PUBSUB_CONNECTION_STRING,
            process.env.AZURE_WEB_PUBSUB_HUB_NAME
        );

        const token = serviceClient.getClientAccessToken(userId, {
            roles: ["sendToGroup", "listen"]
        });

        context.res = {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                url: token.url
            }
        };
    } catch (error) {
        context.log.error("Error generating token:", error);
        context.res = {
            status: 500,
            body: "Error generating token."
        };
    }
};
