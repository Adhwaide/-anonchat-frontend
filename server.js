const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 8080;

// Create Express app
const app = express();
app.use(express.static(__dirname));

// Statistics tracking
let stats = {
    totalChats: 0,
    totalUsers: 0,
    avgChatDuration: 0,
    onlineUsers: 0,
    reportsReceived: 0
};

// Health check and stats endpoints
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        stats: stats
    });
});

app.get('/stats', (req, res) => {
    res.json(stats);
});

// Create HTTP server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log(`Starting Enhanced AnonTalk server on port ${PORT}`);

// User management
const users = new Map();
const waitingUsers = {
    general: [],
    adult: []
};
const reportedUsers = new Set();
const bannedIPs = new Set();

// Interest-based matching
function findBestMatch(newUser, waitingPool) {
    if (waitingPool.length === 0) return null;
    
    // If user has interests, try to find matches
    if (newUser.interests && newUser.interests.length > 0) {
        for (let waitingUser of waitingPool) {
            if (waitingUser.interests && waitingUser.interests.length > 0) {
                const commonInterests = newUser.interests.filter(interest => 
                    waitingUser.interests.includes(interest)
                );
                
                if (commonInterests.length > 0) {
                    return { user: waitingUser, commonInterests };
                }
            }
        }
    }
    
    // If no interest match found, return first available user
    return { user: waitingPool[0], commonInterests: [] };
}

// Content moderation (basic implementation)
const moderationKeywords = [
    'spam', 'scam', 'buy now', 'click here', 'free money',
    // Add more moderation keywords as needed
];

function moderateMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    for (let keyword of moderationKeywords) {
        if (lowerMessage.includes(keyword)) {
            return {
                allowed: false,
                warning: `Message blocked: Contains potentially harmful content (${keyword})`
            };
        }
    }
    
    // Check for excessive caps or repetition
    const capsRatio = (message.match(/[A-Z]/g) || []).length / message.length;
    if (capsRatio > 0.7 && message.length > 10) {
        return {
            allowed: false,
            warning: 'Message blocked: Excessive use of capital letters'
        };
    }
    
    return { allowed: true };
}

wss.on('connection', (ws, req) => {
    const clientIP = req.connection.remoteAddress;
    
    // Check if IP is banned
    if (bannedIPs.has(clientIP)) {
        ws.close(1008, 'Access denied');
        return;
    }
    
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize user data
    const userData = {
        id: userId,
        ws: ws,
        partner: null,
        preferences: null,
        chatStartTime: null,
        messageCount: 0,
        reportCount: 0,
        lastActivity: Date.now(),
        ip: clientIP
    };
    
    users.set(ws, userData);
    stats.onlineUsers++;
    
    console.log(`User ${userId} connected. Total online: ${stats.onlineUsers}`);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            // Handle legacy plain text messages
            handleLegacyMessage(ws, message.toString());
        }
    });
    
    ws.on('close', () => {
        handleDisconnection(ws);
    });
    
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${userId}:`, error);
        handleDisconnection(ws);
    });
    
    // Send initial connection message
    ws.send("Waiting for a partner to connect...");
});

function handleMessage(ws, data) {
    const user = users.get(ws);
    if (!user) return;
    
    user.lastActivity = Date.now();
    
    switch (data.type) {
        case 'user_preferences':
            handleUserPreferences(ws, data.data);
            break;
            
        case 'chat_message':
            handleChatMessage(ws, data.data);
            break;
            
        case 'disconnect_partner':
            handlePartnerDisconnect(ws);
            break;
            
        case 'report_user':
            handleUserReport(ws, data.data);
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleLegacyMessage(ws, message) {
    const user = users.get(ws);
    if (!user) return;
    
    if (message === "partner_disconnected") {
        handlePartnerDisconnect(ws);
    } else {
        // Treat as chat message
        handleChatMessage(ws, { message: message });
    }
}

function handleUserPreferences(ws, preferences) {
    const user = users.get(ws);
    if (!user) return;
    
    user.preferences = preferences;
    
    // Validate age requirements
    if (preferences.chatType === 'adult' && preferences.ageRange === '13-17') {
        ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'Adult chat is restricted to users 18+' }
        }));
        return;
    }
    
    // Parse interests
    if (preferences.interests) {
        user.interests = preferences.interests;
    }
    
    // Find a match
    findMatch(ws);
}

function findMatch(ws) {
    const user = users.get(ws);
    if (!user || !user.preferences) return;
    
    const chatType = user.preferences.chatType || 'general';
    const waitingPool = waitingUsers[chatType];
    
    const match = findBestMatch(user, waitingPool);
    
    if (match) {
        // Remove matched user from waiting pool
        const index = waitingPool.indexOf(match.user);
        waitingPool.splice(index, 1);
        
        // Pair users
        user.partner = match.user;
        match.user.partner = user;
        user.chatStartTime = Date.now();
        match.user.chatStartTime = Date.now();
        
        // Notify both users
        const partnerFoundData = {
            type: 'partner_found',
            data: {
                partnerId: match.user.id,
                commonInterests: match.commonInterests
            }
        };
        
        ws.send(JSON.stringify(partnerFoundData));
        match.user.ws.send(JSON.stringify({
            type: 'partner_found',
            data: {
                partnerId: user.id,
                commonInterests: match.commonInterests
            }
        }));
        
        // Send interest match notification if there are common interests
        if (match.commonInterests.length > 0) {
            const interestData = {
                type: 'interest_match',
                data: { interests: match.commonInterests }
            };
            
            ws.send(JSON.stringify(interestData));
            match.user.ws.send(JSON.stringify(interestData));
        }
        
        stats.totalChats++;
        console.log(`Matched ${user.id} with ${match.user.id}. Common interests: ${match.commonInterests.join(', ')}`);
        
    } else {
        // Add to waiting pool
        waitingPool.push(user);
        ws.send("Waiting for a partner to connect...");
    }
}

function handleChatMessage(ws, data) {
    const user = users.get(ws);
    if (!user || !user.partner) return;
    
    const message = data.message;
    
    // Content moderation
    const moderation = moderateMessage(message);
    
    if (!moderation.allowed) {
        ws.send(JSON.stringify({
            type: 'moderation_warning',
            data: { warning: moderation.warning }
        }));
        
        // Increase report count for repeated violations
        user.reportCount++;
        if (user.reportCount >= 3) {
            handlePartnerDisconnect(ws);
            bannedIPs.add(user.ip);
            ws.close(1008, 'Too many violations');
        }
        return;
    }
    
    // Send message to partner
    if (user.partner.ws.readyState === WebSocket.OPEN) {
        user.partner.ws.send(JSON.stringify({
            type: 'partner_message',
            data: { message: message }
        }));
        
        user.messageCount++;
        user.partner.messageCount++;
    }
}

function handlePartnerDisconnect(ws) {
    const user = users.get(ws);
    if (!user) return;
    
    if (user.partner) {
        // Calculate chat duration
        const chatDuration = user.chatStartTime ? 
            (Date.now() - user.chatStartTime) / 1000 : 0;
        
        // Update average chat duration
        if (chatDuration > 0) {
            stats.avgChatDuration = (stats.avgChatDuration + chatDuration) / 2;
        }
        
        // Notify partner
        if (user.partner.ws.readyState === WebSocket.OPEN) {
            user.partner.ws.send(JSON.stringify({
                type: 'partner_disconnected',
                data: {}
            }));
        }
        
        // Clear partnership
        user.partner.partner = null;
        user.partner.chatStartTime = null;
        user.partner = null;
        user.chatStartTime = null;
        
        console.log(`${user.id} disconnected from partner. Chat duration: ${chatDuration}s`);
    }
    
    // Remove from waiting pools
    Object.values(waitingUsers).forEach(pool => {
        const index = pool.indexOf(user);
        if (index > -1) pool.splice(index, 1);
    });
}

function handleUserReport(ws, data) {
    const user = users.get(ws);
    if (!user || !user.partner) return;
    
    console.log(`Report received: ${user.id} reported ${user.partner.id} for ${data.reason}`);
    
    // Add to reported users set
    reportedUsers.add(user.partner.id);
    stats.reportsReceived++;
    
    // If user has multiple reports, take action
    const reportedUser = user.partner;
    reportedUser.reportCount = (reportedUser.reportCount || 0) + 1;
    
    if (reportedUser.reportCount >= 3) {
        bannedIPs.add(reportedUser.ip);
        if (reportedUser.ws.readyState === WebSocket.OPEN) {
            reportedUser.ws.close(1008, 'Multiple reports received');
        }
        console.log(`User ${reportedUser.id} banned due to multiple reports`);
    }
    
    // Confirm report received
    ws.send(JSON.stringify({
        type: 'user_reported',
        data: { success: true }
    }));
    
    // Disconnect the reported user from current chat
    handlePartnerDisconnect(user.partner.ws);
}

function handleDisconnection(ws) {
    const user = users.get(ws);
    if (!user) return;
    
    console.log(`User ${user.id} disconnected`);
    
    // Handle partner disconnection
    handlePartnerDisconnect(ws);
    
    // Remove from users map
    users.delete(ws);
    stats.onlineUsers = Math.max(0, stats.onlineUsers - 1);
}

// Cleanup inactive connections
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    users.forEach((user, ws) => {
        if (now - user.lastActivity > timeout) {
            console.log(`Cleaning up inactive user: ${user.id}`);
            ws.close(1001, 'Inactive');
        }
    });
    
    // Ping all connections to detect dead ones
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Handle pong responses
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Enhanced AnonTalk server running on port ${PORT}`);
    console.log(`Features: Interest matching, Content moderation, Reporting system`);
    console.log(`Stats endpoint: http://localhost:${PORT}/stats`);
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
