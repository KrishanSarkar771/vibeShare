const socket = io();

let localStream = null;
let peer = null;
let partnerId = null;

// DOM elements
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const status = document.getElementById('status');
const myIdSpan = document.getElementById('myId');
const videoButton = document.getElementById('video-button');
const nextButton = document.getElementById('next-button');
const userCountSpan = document.getElementById('userCount');

// ========== Start Local Media ==========
async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error('Media access error:', err);
        status.innerText = 'Error accessing camera/mic';
    }
}

// ========== Create Peer Connection ==========
function createPeerConnection() {
    peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Add local tracks to connection
    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });

    // Handle ICE candidates
    peer.onicecandidate = event => {
        if (event.candidate && partnerId) {
            socket.emit('ice-candidate', { candidate: event.candidate, to: partnerId });
        }
    };

    // Handle remote stream
    peer.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };

    // Handle disconnection
    peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        if (['disconnected', 'failed', 'closed'].includes(state)) {
            status.innerText = 'Disconnected from stranger';
            cleanupPeer();
        }
    };
}

// ========== Clean Up ==========
function cleanupPeer() {
    if (peer) {
        peer.close();
        peer = null;
    }
    partnerId = null;
    remoteVideo.srcObject = null;
}

// ========== Find a Partner ==========
function findPartner() {
    cleanupPeer();
    status.innerText = 'Finding a stranger...';
    socket.emit('ready');
}

// ========== Socket Events ==========

// On connection
socket.on('connect', async () => {
    myIdSpan.innerText = socket.id;
    await startLocalStream();
    findPartner();
});

// Matched with partner (caller)
socket.on('matched', async ({ peerId }) => {
    partnerId = peerId;
    status.innerText = 'Stranger found! Connecting...';
    createPeerConnection();

    try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit('offer', { offer, to: partnerId });
    } catch (err) {
        console.error('Error creating offer:', err);
    }
});

// Received offer (callee)
socket.on('offer', async ({ offer, from }) => {
    partnerId = from;
    status.innerText = 'Stranger is calling...';
    createPeerConnection();

    try {
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('answer', { answer, to: from });
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

// Received answer
socket.on('answer', async ({ answer }) => {
    try {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        status.innerText = 'Connected!';
    } catch (err) {
        console.error('Error setting remote description (answer):', err);
    }
});

// Received ICE candidate
socket.on('ice-candidate', async ({ candidate }) => {
    try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Partner disconnected
socket.on('peer-disconnected', () => {
    status.innerText = 'Stranger disconnected.';
    cleanupPeer();
    setTimeout(findPartner, 1000);
});

// Update user count
socket.on('userCount', count => {
    userCountSpan.innerText = `${count}`;
});

// ========== UI Interactions ==========

// "Next" button logic
let nextClickTimeout = null;

nextButton.addEventListener('click', () => {
    if (nextClickTimeout) return;
    nextClickTimeout = setTimeout(() => (nextClickTimeout = null), 1000);

    status.innerText = 'Looking for a new stranger...';
    socket.emit('next');
    cleanupPeer();
});

// Toggle video on/off
videoButton.addEventListener('click', () => {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoTrack.enabled = !videoTrack.enabled;
    videoButton.innerText = videoTrack.enabled ? 'Stop Video' : 'Start Video';
});
