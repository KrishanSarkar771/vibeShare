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
const audioButton = document.getElementById('audio-button');
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
        iceServers: [
            //{ urls: 'stun:stun.l.google.com:19302' },
           {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:asia.relay.metered.ca:80",
        username: "b702308c255e4f2643c9cc79",
        credential: "1u5qapo/2klEaMBe",
      },
      {
        urls: "turn:asia.relay.metered.ca:80?transport=tcp",
        username: "b702308c255e4f2643c9cc79",
        credential: "1u5qapo/2klEaMBe",
      },
      {
        urls: "turn:asia.relay.metered.ca:443",
        username: "b702308c255e4f2643c9cc79",
        credential: "1u5qapo/2klEaMBe",
      },
      {
        urls: "turns:asia.relay.metered.ca:443?transport=tcp",
        username: "b702308c255e4f2643c9cc79",
        credential: "1u5qapo/2klEaMBe",
      },
        ],
        bundlePolicy: 'max-bundle',
        iceTransportPolicy: 'all',
    });

    // Add local tracks
    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });

    // Send ICE candidates (Trickle ICE)
    peer.onicecandidate = event => {
        if (event.candidate && partnerId) {
            console.log('[ICE] Sending candidate:', event.candidate);
            socket.emit('ice-candidate', { candidate: event.candidate, to: partnerId });
        }
    };

    // Handle remote stream
    peer.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };

    // ICE connection state monitoring
    peer.oniceconnectionstatechange = () => {
        console.log('[ICE] Connection State:', peer.iceConnectionState);

        if (peer.iceConnectionState === 'failed') {
            console.warn('[ICE] Connection failed. Restarting ICE...');
            peer.restartIce();
        }
    };

    // Peer connection state monitoring
    peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        console.log('[Peer] Connection state:', state);

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

// ========== Wait for Peer to Be Ready ==========
async function ensurePeerReady() {
    return new Promise(resolve => {
        const check = () => {
            if (peer) resolve();
            else setTimeout(check, 50);
        };
        check();
    });
}

// ========== Socket Events ==========

socket.on('connect', async () => {
    myIdSpan.innerText = socket.id;
    console.log('[Socket] Connected:', socket.id);
    await startLocalStream();
    findPartner();
});

socket.on('matched', async ({ peerId }) => {
    partnerId = peerId;
    console.log('[Match] Matched with:', partnerId);
    status.innerText = 'Stranger found! Connecting...';

    createPeerConnection();

    try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        console.log('[Offer] Sending offer to', partnerId);
        socket.emit('offer', { offer, to: partnerId });
    } catch (err) {
        console.error('[Offer] Error creating offer:', err);
    }
});

socket.on('offer', async ({ offer, from }) => {
    partnerId = from;
    console.log('[Offer] Received from', from);

    if (!peer) createPeerConnection();
    await ensurePeerReady();

    try {
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        console.log('[Answer] Sending answer to', from);
        socket.emit('answer', { answer, to: from });
    } catch (err) {
        console.error('[Offer] Error handling offer:', err);
    }
});

socket.on('answer', async ({ answer }) => {
    console.log('[Answer] Received');
    try {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        status.innerText = 'Connected!';
    } catch (err) {
        console.error('[Answer] Error setting remote description:', err);
    }
});

socket.on('ice-candidate', async ({ candidate }) => {
    console.log('[ICE] Received candidate');
    await ensurePeerReady();

    try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error('[ICE] Error adding candidate:', err);
    }
});

socket.on('peer-disconnected', () => {
    console.log('[Peer] Stranger disconnected');
    status.innerText = 'Stranger disconnected.';
    cleanupPeer();
    setTimeout(findPartner, 1000);
});

socket.on('userCount', count => {
    userCountSpan.innerText = `${count}`;
});

// ========== UI Interactions ==========

let nextClickTimeout = null;

nextButton.addEventListener('click', () => {
    if (nextClickTimeout) return;
    nextClickTimeout = setTimeout(() => (nextClickTimeout = null), 1000);

    status.innerText = 'Looking for a new stranger...';
    socket.emit('next');
    cleanupPeer();
    resetMediaButtons();
});

videoButton.addEventListener('click', () => {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoTrack.enabled = !videoTrack.enabled;
    videoButton.innerText = videoTrack.enabled ? 'Stop Video' : 'Start Video';
});

audioButton.addEventListener('click', () => {
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    audioTrack.enabled = !audioTrack.enabled;
    if (audioTrack.enabled) {
        audioButton.innerText = 'Mute';
        audioButton.classList.remove('muted');
    } else {
        audioButton.innerText = 'Unmute';
        audioButton.classList.add('muted');
    }
});

function resetMediaButtons() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = true;
            videoButton.innerText = 'Stop Video';
        }
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = true;
            audioButton.innerText = 'Mute';
            audioButton.classList.remove('muted');
        }
    }
}
