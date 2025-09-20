const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// Use Railway's assigned port or fallback
const PORT = process.env.PORT || 8080;

// Create Express app for health checks
const app = express();

// Health check endpoint (required by some hosting providers)
app.get('/', (req, res) => {
    res.json({ 
        status: 'AnonTalk WebSocket Server Running',
        connections: wss.clients.size,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        connections: wss.clients.size 
    });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

console.log(`Starting AnonTalk server on port ${PORT}`);

let waitingUser = null;
let totalConnections = 0;

wss.on('connection', (ws, req) => {
    totalConnections++;
    console.log(`User connected. Total connections: ${totalConnections}`);
    
    // Add connection metadata
    ws.isAlive = true;
    ws.id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (waitingUser && waitingUser.readyState === WebSocket.OPEN) {
        // Pair with waiting user
        ws.partner = waitingUser;
        waitingUser.partner = ws;

        ws.send("You are now connected!");
        waitingUser.send("You are now connected!");
        
        console.log(`Paired ${ws.id} with ${waitingUser.id}`);
        waitingUser = null;
    } else {
        // Become the waiting user
        waitingUser = ws;
        ws.send("Waiting for a partner to connect...");
        console.log(`${ws.id} is waiting for a partner`);
    }

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const textMessage = message.toString();
            
            // Check if user wants to disconnect
            if (textMessage === "partner_disconnected") {
                handleDisconnection(ws);
                return;
            }
            
            // Forward message to partner
            if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
                ws.partner.send(textMessage);
            } else {
                ws.send("No partner connected.");
            }
        } catch (error) {
            console.error('Message handling error:', error);
        }
    });

    // Handle connection close
    ws.on('close', () => {
        console.log(`User ${ws.id} disconnected`);
        handleDisconnection(ws);
    });

    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${ws.id}:`, error);
        handleDisconnection(ws);
    });

    // Heartbeat to detect broken connections
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

function handleDisconnection(ws) {
    if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
        ws.partner.send("Your partner has disconnected.");
        ws.partner.partner = null;
    } else if (waitingUser === ws) {
        waitingUser = null;
    }
    
    if (ws.partner) {
        ws.partner = null;
    }
}

// Heartbeat interval to clean up dead connections
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log(`Terminating dead connection: ${ws.id}`);
            handleDisconnection(ws);
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
    });
}, 30000); // Check every 30 seconds

// Cleanup on server shutdown
wss.on('close', () => {
    clearInterval(interval);
});

// Start the server
server.listen(PORT, () => {
    console.log(`AnonTalk server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    server.close(() => {
        process.exit(0);
    });
});
