const http = require('http');
const express = require('express');
const { Server: SocketIO } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server);

const PORT = process.env.PORT || 8000;

const waitingQueue = [];             // Users waiting to be paired
const activePairs = new Map();       // socket.id => partnerId

// Attempt to match users from the waiting queue
function tryMatchUsers() {
    while (waitingQueue.length >= 2) {
        const userA = waitingQueue.shift();
        const userB = waitingQueue.shift();

        if (userA === userB) {
            // Edge case: same user (shouldn't happen, but be safe)
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

// Broadcast the number of connected users
function broadcastUserCount() {
    io.emit('userCount', io.engine.clientsCount);
}

// Socket.IO Event Handling
io.on('connection', socket => {
    console.log(`User connected: ${socket.id}`);
    broadcastUserCount();

    // Add user to queue and attempt match
    waitingQueue.push(socket.id);
    tryMatchUsers();

    // === Signaling Messages ===
    socket.on('offer', ({ offer, to }) => {
        io.to(to).emit('offer', { offer, from: socket.id });
    });

    socket.on('answer', ({ answer, to }) => {
        io.to(to).emit('answer', { answer });
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
        io.to(to).emit('ice-candidate', { candidate });
    });

    // === User Clicked "Next" ===
    socket.on('next', () => {
        const partnerId = activePairs.get(socket.id);
        if (!partnerId) return;

        console.log(`Next: ${socket.id} and ${partnerId} disconnected`);

        // Notify the current partner
        io.to(partnerId).emit('peer-disconnected');

        // Remove both from active pairs
        activePairs.delete(socket.id);
        activePairs.delete(partnerId);

        // Re-add both to the waiting queue
        waitingQueue.push(socket.id, partnerId);
        tryMatchUsers();
    });

    // === Handle Disconnection ===
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        broadcastUserCount();

        // Remove from queue
        const index = waitingQueue.indexOf(socket.id);
        if (index !== -1) {
            waitingQueue.splice(index, 1);
        }

        // Notify partner if matched
        const partnerId = activePairs.get(socket.id);
        if (partnerId) {
            console.log(`Notifying ${partnerId} about ${socket.id}'s disconnection`);
            io.to(partnerId).emit('peer-disconnected');

            activePairs.delete(socket.id);
            activePairs.delete(partnerId);

            // Requeue partner
            waitingQueue.push(partnerId);
            tryMatchUsers();
        }
    });
});

// === Serve Static Files ===
app.use(express.static(path.join(__dirname, 'public')));

// Default route (can be changed as needed)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
