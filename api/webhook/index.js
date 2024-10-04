// api/webhook/index.js

const WebSocket = require('ws');
const { WebPubSubServiceClient } = require("@azure/web-pubsub");
require('dotenv').config();

/**
 * In-memory map to track client connections and their corresponding OpenAI WebSocket connections.
 * In production, consider using a more robust solution like a database or distributed cache.
 */
const clientMap = new Map();

/**
 * Azure Function to handle Web PubSub webhook events.
 * 
 * It processes connection, disconnection, and message events.
 */
module.exports = async function (context, req) {
    const event = req.body;

    if (!event || !event.type) {
        context.log.error("Invalid event received.");
        context.res = {
            status: 400,
            body: "Invalid event."
        };
        return;
    }

    const serviceClient = new WebPubSubServiceClient(
        process.env.AZURE_WEB_PUBSUB_CONNECTION_STRING,
        process.env.AZURE_WEB_PUBSUB_HUB_NAME
    );

    switch (event.type) {
        case "webPubSub.connection":
            await handleConnection(event, serviceClient, context);
            break;

        case "webPubSub.disconnected":
            await handleDisconnection(event, serviceClient, context);
            break;

        case "webPubSub.message":
            await handleMessage(event, serviceClient, context);
            break;

        default:
            context.log(`Unhandled event type: ${event.type}`);
            break;
    }

    context.res = {
        status: 200,
        body: "Event processed."
    };
};

/**
 * Handles client connection events.
 */
async function handleConnection(event, serviceClient, context) {
    const connectionId = event.data.connectionId;
    context.log(`Client connected: ${connectionId}`);

    // No immediate action needed on connection.
    // Optionally, send a welcome message.
}

/**
 * Handles client disconnection events.
 */
async function handleDisconnection(event, serviceClient, context) {
    const connectionId = event.data.connectionId;
    context.log(`Client disconnected: ${connectionId}`);

    // Close the OpenAI WebSocket connection if it exists
    const openaiWs = clientMap.get(connectionId);
    if (openaiWs) {
        openaiWs.close();
        clientMap.delete(connectionId);
        context.log(`Closed OpenAI connection for client ${connectionId}`);
    }
}

/**
 * Handles incoming messages from clients.
 */
async function handleMessage(event, serviceClient, context) {
    const connectionId = event.data.connectionId;
    const message = event.data.message;

    context.log(`Received message from ${connectionId}: ${message}`);

    let openaiWs = clientMap.get(connectionId);

    // If there's no existing OpenAI connection for this client, establish one
    if (!openaiWs) {
        const openaiUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";

        openaiWs = new WebSocket(openaiUrl, {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        openaiWs.on('open', () => {
            context.log(`Connected to OpenAI for client ${connectionId}`);

            // Send initial response.create event
            const initialEvent = {
                type: "response.create",
                response: {
                    modalities: ["text", "audio"],
                    instructions: "Please assist the user."
                }
            };
            openaiWs.send(JSON.stringify(initialEvent));
        });

        openaiWs.on('message', async (data) => {
            // Relay message from OpenAI to the client via Web PubSub
            try {
                await serviceClient.sendToConnection(connectionId, data, {
                    contentType: "application/json"
                });
            } catch (error) {
                context.log.error(`Error sending message to client ${connectionId}:`, error);
            }
        });

        openaiWs.on('close', () => {
            context.log(`OpenAI connection closed for client ${connectionId}`);
            clientMap.delete(connectionId);
        });

        openaiWs.on('error', (error) => {
            context.log.error(`OpenAI WebSocket error for client ${connectionId}:`, error);
            clientMap.delete(connectionId);
        });

        // Store the OpenAI WebSocket connection
        clientMap.set(connectionId, openaiWs);
    }

    // Relay message from client to OpenAI
    openaiWs.send(message);
}
