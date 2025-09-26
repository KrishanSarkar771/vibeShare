const http = require('http');
const express = require('express');
const { Server: SocketIO } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server);

const PORT = process.env.PORT || 8000;

const waitingQueue = [];             // Users waiting to be paired
const activePairs = new Map();       // Map: socket.id => partnerId

// ========== Matchmaking Logic ==========
function tryMatchUsers() {
    while (waitingQueue.length >= 2) {
        const userA = waitingQueue.shift();
        const userB = waitingQueue.shift();

        // Prevent matching user with themselves (edge case)
        if (userA === userB) {
            waitingQueue.unshift(userB);
            continue;
        }

        activePairs.set(userA, userB);
        activePairs.set(userB, userA);

        console.log(`Matched: ${userA} <--> ${userB}`);

        io.to(userA).emit('matched', { peerId: userB });
        io.to(userB).emit('matched', { peerId: userA });
    }
}

// ========== Broadcast User Count ==========
function broadcastUserCount() {
    io.emit('userCount', io.engine.clientsCount);
}

// ========== Socket.IO Connection Handling ==========
io.on('connection', socket => {
    console.log(`User connected: ${socket.id}`);
    broadcastUserCount();

    // Add user to waiting queue and try to match
    waitingQueue.push(socket.id);
    tryMatchUsers();

    // Offer relay
    socket.on('offer', ({ offer, to }) => {
        socket.to(to).emit('offer', { offer, from: socket.id });
    });

    // Answer relay
    socket.on('answer', ({ answer, to }) => {
        socket.to(to).emit('answer', { answer });
    });

    // ICE candidate relay
    socket.on('ice-candidate', ({ candidate, to }) => {
        socket.to(to).emit('ice-candidate', { candidate });
    });

    // User clicks "Next"
    socket.on('next', () => {
        const partnerId = activePairs.get(socket.id);
        if (!partnerId) return;

        // Notify partner
        io.to(partnerId).emit('peer-disconnected');

        console.log(`Next: Unmatched ${socket.id} & ${partnerId}`);

        // Remove both from active pairs
        activePairs.delete(socket.id);
        activePairs.delete(partnerId);

        // Requeue both users
        waitingQueue.push(socket.id);
        waitingQueue.push(partnerId);

        tryMatchUsers();
    });

    // Handle disconnects
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        broadcastUserCount();

        // Remove from waiting queue if present
        const index = waitingQueue.indexOf(socket.id);
        if (index !== -1) {
            waitingQueue.splice(index, 1);
        }

        // Notify partner and cleanup
        const partnerId = activePairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('peer-disconnected');
            activePairs.delete(partnerId);
            activePairs.delete(socket.id);

            // Requeue partner
            waitingQueue.push(partnerId);
            tryMatchUsers();
        }
    });
});

// ========== Static File Serving ==========
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ========== Start Server ==========
server.listen(PORT, () => {
    console.log(`🚀 Server running at: http://localhost:${PORT}`);
});
