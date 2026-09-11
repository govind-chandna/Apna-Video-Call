import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import server from "../environment";

import styles from "../styles/videoComponent.module.css";

import { Button, IconButton, TextField } from "@mui/material";

import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import CallEndIcon from "@mui/icons-material/CallEnd";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import ChatIcon from "@mui/icons-material/Chat";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import io from "socket.io-client";


function VideoMeet() {
    const socketRef = useRef(null);
    const socketIdRef = useRef(null);

    const localVideoref = useRef(null);

    const connections = useRef({});
    const pendingIceCandidates = useRef({});

    const navigate = useNavigate();
    const { url } = useParams();

    const [askForUsername, setAskForUsername] = useState(true);
    const [username, setUsername] = useState("");

    const [videoAvailable, setVideoAvailable] = useState(true);
    const [audioAvailable, setAudioAvailable] = useState(true);

    const videoAvailableRef = useRef(true);
    const audioAvailableRef = useRef(true);

    const [video, setVideo] = useState(true);
    const [audio, setAudio] = useState(true);

    const [videos, setVideos] = useState([]);

    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState("");

    const [newMessages, setNewMessages] = useState(0);

    const [askForUsernameError, setAskForUsernameError] = useState("");

    const [showModal, setShowModal] = useState(false);

    const [screen, setScreen] = useState(false);

    const [copySuccess, setCopySuccess] = useState(false);


    // --------------------------------------------------
    // GET CAMERA + MICROPHONE PERMISSION
    // --------------------------------------------------

    const getPermissions = async () => {
        let videoPermission = false;
        let audioPermission = false;

        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });

            videoPermission = true;

            videoStream.getTracks().forEach((track) => {
                track.stop();
            });

            console.log("Video permission granted");

        } catch (err) {
            console.log("Video permission denied");
        }


        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: true
            });

            audioPermission = true;

            audioStream.getTracks().forEach((track) => {
                track.stop();
            });

            console.log("Audio permission granted");

        } catch (err) {
            console.log("Audio permission denied");
        }


        videoAvailableRef.current = videoPermission;
        audioAvailableRef.current = audioPermission;

        setVideoAvailable(videoPermission);
        setAudioAvailable(audioPermission);

        setVideo(videoPermission);
        setAudio(audioPermission);
    };


    // --------------------------------------------------
    // INITIAL PERMISSION CHECK
    // --------------------------------------------------

    useEffect(() => {
        getPermissions();

        return () => {
            if (window.localStream) {
                window.localStream.getTracks().forEach((track) => {
                    track.stop();
                });
            }

            if (window.screenStream) {
                window.screenStream.getTracks().forEach((track) => {
                    track.stop();
                });
            }

            Object.values(connections.current).forEach((connection) => {
                try {
                    connection.close();
                } catch (err) {
                    console.log(err);
                }
            });

            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, []);


    // --------------------------------------------------
    // CREATE LOCAL MEDIA STREAM
    // --------------------------------------------------

    const prepareLocalMedia = async () => {
        try {
            const needVideo = videoAvailableRef.current;
            const needAudio = audioAvailableRef.current;

            let stream = window.localStream;

            const hasVideo =
                stream &&
                stream.getVideoTracks &&
                stream.getVideoTracks().length > 0;

            const hasAudio =
                stream &&
                stream.getAudioTracks &&
                stream.getAudioTracks().length > 0;


            // Already have correct stream
            if (
                stream &&
                (!needVideo || hasVideo) &&
                (!needAudio || hasAudio)
            ) {
                stream.getVideoTracks().forEach((track) => {
                    track.enabled = video;
                });

                stream.getAudioTracks().forEach((track) => {
                    track.enabled = audio;
                });

                if (localVideoref.current) {
                    localVideoref.current.srcObject = stream;
                }

                return stream;
            }


            // If old stream exists, stop it first
            if (stream) {
                stream.getTracks().forEach((track) => {
                    track.stop();
                });
            }


            // Browser does not allow both false
            if (!needVideo && !needAudio) {
                const emptyStream = new MediaStream();

                window.localStream = emptyStream;

                if (localVideoref.current) {
                    localVideoref.current.srcObject = emptyStream;
                }

                return emptyStream;
            }


            stream = await navigator.mediaDevices.getUserMedia({
                video: needVideo,
                audio: needAudio
            });


            stream.getVideoTracks().forEach((track) => {
                track.enabled = video;
            });

            stream.getAudioTracks().forEach((track) => {
                track.enabled = audio;
            });


            window.localStream = stream;


            if (localVideoref.current) {
                localVideoref.current.srcObject = stream;
            }


            console.log("Local media stream ready");

            return stream;

        } catch (error) {
            console.error("MEDIA ERROR:", error);

            alert(
                "Camera/Microphone access nahi mil raha. Browser permission check karo."
            );

            throw error;
        }
    };


    // --------------------------------------------------
    // CREATE PEER CONNECTION
    // --------------------------------------------------

    const createPeerConnection = (remoteId) => {

        if (connections.current[remoteId]) {
            return connections.current[remoteId];
        }


        const peer = new RTCPeerConnection({
            iceServers: [
                {
                    urls: "stun:stun.l.google.com:19302"
                }
            ]
        });


        connections.current[remoteId] = peer;


        // -------------------------------
        // ADD LOCAL TRACKS
        // -------------------------------

        const localStream = window.localStream;

        if (localStream) {

            localStream.getTracks().forEach((track) => {

                try {
                    peer.addTrack(track, localStream);
                } catch (error) {
                    console.log("ADD TRACK ERROR:", error);
                }

            });

        } else {
            console.log("WARNING: Local stream not ready");
        }


        // -------------------------------
        // ICE CANDIDATE
        // -------------------------------

        peer.onicecandidate = (event) => {

            if (event.candidate && socketRef.current) {

                socketRef.current.emit(
                    "signal",
                    remoteId,
                    JSON.stringify({
                        ice: event.candidate
                    })
                );

            }

        };


        // -------------------------------
        // REMOTE VIDEO
        // -------------------------------

        peer.ontrack = (event) => {

            const stream = event.streams && event.streams[0];

            if (!stream) return;


            setVideos((currentVideos) => {

                const alreadyExists = currentVideos.some(
                    (video) => video.socketId === remoteId
                );


                if (alreadyExists) {

                    return currentVideos.map((video) => {

                        if (video.socketId === remoteId) {

                            return {
                                ...video,
                                stream: stream
                            };

                        }

                        return video;

                    });

                }


                return [
                    ...currentVideos,
                    {
                        socketId: remoteId,
                        stream: stream
                    }
                ];

            });

        };


        // -------------------------------
        // CONNECTION STATE
        // -------------------------------

        peer.onconnectionstatechange = () => {

            const state = peer.connectionState;

            console.log(
                "Peer",
                remoteId,
                "connection state:",
                state
            );


            if (
                state === "failed" ||
                state === "closed"
            ) {

                cleanupConnection(remoteId);

            }

        };


        return peer;
    };


    // --------------------------------------------------
    // CLEANUP ONE CONNECTION
    // --------------------------------------------------

    const cleanupConnection = (remoteId) => {

        const peer = connections.current[remoteId];

        if (peer) {

            try {
                peer.ontrack = null;
                peer.onicecandidate = null;
                peer.close();
            } catch (error) {
                console.log(error);
            }

        }


        delete connections.current[remoteId];

        delete pendingIceCandidates.current[remoteId];


        setVideos((currentVideos) =>
            currentVideos.filter(
                (video) => video.socketId !== remoteId
            )
        );

    };


    // --------------------------------------------------
    // CREATE OFFER
    // --------------------------------------------------

    const createOfferFor = async (remoteId) => {

        const peer = connections.current[remoteId];

        if (!peer) {
            console.log(
                "Offer skipped - peer does not exist:",
                remoteId
            );

            return;
        }


        if (!socketRef.current) return;


        if (peer.signalingState !== "stable") {

            console.log(
                "Offer skipped - signaling state:",
                peer.signalingState
            );

            return;
        }


        try {

            const offer = await peer.createOffer();


            if (!connections.current[remoteId]) {
                return;
            }


            if (peer.signalingState !== "stable") {
                return;
            }


            await peer.setLocalDescription(offer);


            if (!peer.localDescription) {
                return;
            }


            socketRef.current.emit(
                "signal",
                remoteId,
                JSON.stringify({
                    sdp: peer.localDescription
                })
            );


        } catch (error) {

            console.error(
                "CREATE OFFER ERROR:",
                error
            );

        }

    };


    // --------------------------------------------------
    // HANDLE SIGNAL
    // --------------------------------------------------

    const gotMessageFromServer = async (
        fromId,
        message
    ) => {

        try {

            const signal = JSON.parse(message);


            let peer = connections.current[fromId];


            if (!peer) {

                peer = createPeerConnection(fromId);

            }


            // ------------------------------------
            // ICE
            // ------------------------------------

            if (signal.ice) {

                if (peer.remoteDescription) {

                    try {

                        await peer.addIceCandidate(
                            new RTCIceCandidate(signal.ice)
                        );

                    } catch (error) {

                        console.log(
                            "ICE ERROR:",
                            error
                        );

                    }

                } else {

                    if (!pendingIceCandidates.current[fromId]) {

                        pendingIceCandidates.current[fromId] = [];

                    }

                    pendingIceCandidates.current[fromId].push(
                        signal.ice
                    );

                }

                return;
            }


            // ------------------------------------
            // SDP
            // ------------------------------------

            if (!signal.sdp) {
                return;
            }


            const description = signal.sdp;


            // ------------------------------------
            // ANSWER
            // ------------------------------------

            if (description.type === "answer") {

                if (
                    peer.signalingState !==
                    "have-local-offer"
                ) {

                    console.log(
                        "Ignoring answer. Current state:",
                        peer.signalingState
                    );

                    return;
                }


                await peer.setRemoteDescription(
                    new RTCSessionDescription(description)
                );


                const queued =
                    pendingIceCandidates.current[fromId] || [];


                for (const candidate of queued) {

                    try {

                        await peer.addIceCandidate(
                            new RTCIceCandidate(candidate)
                        );

                    } catch (error) {

                        console.log(
                            "Queued ICE ERROR:",
                            error
                        );

                    }

                }


                pendingIceCandidates.current[fromId] = [];


                return;
            }


            // ------------------------------------
            // OFFER
            // ------------------------------------

            if (description.type === "offer") {

                if (
                    peer.signalingState !==
                    "stable"
                ) {

                    console.log(
                        "Ignoring offer. Current state:",
                        peer.signalingState
                    );

                    return;
                }


                await peer.setRemoteDescription(
                    new RTCSessionDescription(description)
                );


                const queued =
                    pendingIceCandidates.current[fromId] || [];


                for (const candidate of queued) {

                    try {

                        await peer.addIceCandidate(
                            new RTCIceCandidate(candidate)
                        );

                    } catch (error) {

                        console.log(
                            "Queued ICE ERROR:",
                            error
                        );

                    }

                }


                pendingIceCandidates.current[fromId] = [];


                const answer =
                    await peer.createAnswer();


                await peer.setLocalDescription(answer);


                if (
                    socketRef.current &&
                    peer.localDescription
                ) {

                    socketRef.current.emit(
                        "signal",
                        fromId,
                        JSON.stringify({
                            sdp: peer.localDescription
                        })
                    );

                }

            }

        } catch (error) {

            console.error(
                "SIGNAL ERROR:",
                error
            );

        }

    };


    // --------------------------------------------------
    // CONNECT SOCKET
    // --------------------------------------------------

    const connectToSocketServer = () => {

        if (socketRef.current) {
            return;
        }


        const socket = io(server);

        socketRef.current = socket;


        // ------------------------------------
        // CONNECT
        // ------------------------------------

        socket.on("connect", () => {

            socketIdRef.current = socket.id;


            console.log(
                "Socket connected:",
                socket.id
            );


            socket.emit(
                "join-call",
                url
            );

        });


        // ------------------------------------
        // USER JOINED
        // ------------------------------------

        socket.on(
            "user-joined",
            async (id, clients) => {

                console.log(
                    "User joined:",
                    id
                );


                // Create peer connections
                // for all other clients

                for (const clientId of clients) {

                    if (
                        clientId === socketIdRef.current
                    ) {
                        continue;
                    }


                    createPeerConnection(
                        clientId
                    );

                }


                // IMPORTANT:
                // Only the newly joined user
                // creates offers.

                if (
                    id === socketIdRef.current
                ) {

                    for (const clientId of clients) {

                        if (
                            clientId === socketIdRef.current
                        ) {
                            continue;
                        }


                        await createOfferFor(
                            clientId
                        );

                    }

                }

            }
        );


        // ------------------------------------
        // SIGNAL
        // ------------------------------------

        socket.on(
            "signal",
            gotMessageFromServer
        );


        // ------------------------------------
        // USER LEFT
        // ------------------------------------

        socket.on(
            "user-left",
            (id) => {

                console.log(
                    "User left:",
                    id
                );

                cleanupConnection(id);

            }
        );


        // ------------------------------------
        // CHAT MESSAGE
        // ------------------------------------

        socket.on(
            "chat-message",
            (data, sender, socketIdSender) => {

                setMessages((currentMessages) => [
                    ...currentMessages,
                    {
                        data: data,
                        sender: sender
                    }
                ]);


                setNewMessages(
                    (currentCount) =>
                        currentCount + 1
                );

            }
        );

    };


    // --------------------------------------------------
    // JOIN MEETING
    // --------------------------------------------------

    const connect = async () => {

        setAskForUsernameError("");


        if (!username.trim()) {

            setAskForUsernameError(
                "Please enter your name"
            );

            return;
        }


        try {

            // VERY IMPORTANT:
            // Media is ready BEFORE socket/WebRTC.

            await prepareLocalMedia();


            setAskForUsername(false);


            connectToSocketServer();

        } catch (error) {

            console.error(
                "JOIN ERROR:",
                error
            );

        }

    };


    // --------------------------------------------------
    // VIDEO ON/OFF
    // --------------------------------------------------

    const handleVideo = () => {

        const newValue = !video;

        setVideo(newValue);


        if (window.localStream) {

            window.localStream
                .getVideoTracks()
                .forEach((track) => {

                    track.enabled = newValue;

                });

        }

    };


    // --------------------------------------------------
    // AUDIO ON/OFF
    // --------------------------------------------------

    const handleAudio = () => {

        const newValue = !audio;

        setAudio(newValue);


        if (window.localStream) {

            window.localStream
                .getAudioTracks()
                .forEach((track) => {

                    track.enabled = newValue;

                });

        }

    };


    // --------------------------------------------------
    // SCREEN SHARE
    // --------------------------------------------------

    const handleScreen = async () => {

        if (screen) {

            // Stop screen sharing

            setScreen(false);


            const cameraStream =
                window.localStream;


            if (!cameraStream) {
                return;
            }


            const cameraTrack =
                cameraStream.getVideoTracks()[0];


            if (!cameraTrack) {
                return;
            }


            cameraTrack.enabled = video;


            // Put camera back in local video

            if (localVideoref.current) {

                localVideoref.current.srcObject =
                    cameraStream;

            }


            // Replace screen track
            // with camera track

            for (
                const remoteId of Object.keys(
                    connections.current
                )
            ) {

                const peer =
                    connections.current[remoteId];


                const sender =
                    peer
                        .getSenders()
                        .find(
                            (s) =>
                                s.track &&
                                s.track.kind ===
                                    "video"
                        );


                if (sender) {

                    try {

                        await sender.replaceTrack(
                            cameraTrack
                        );

                    } catch (error) {

                        console.log(
                            "CAMERA REPLACE ERROR:",
                            error
                        );

                    }

                }

            }


            if (window.screenStream) {

                window.screenStream
                    .getTracks()
                    .forEach((track) =>
                        track.stop()
                    );

                window.screenStream = null;

            }


            return;
        }


        // Start screen sharing

        try {

            const stream =
                await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: false
                });


            const screenTrack =
                stream.getVideoTracks()[0];


            window.screenStream = stream;


            if (localVideoref.current) {

                localVideoref.current.srcObject =
                    stream;

            }


            for (
                const remoteId of Object.keys(
                    connections.current
                )
            ) {

                const peer =
                    connections.current[remoteId];


                const sender =
                    peer
                        .getSenders()
                        .find(
                            (s) =>
                                s.track &&
                                s.track.kind ===
                                    "video"
                        );


                if (sender) {

                    try {

                        await sender.replaceTrack(
                            screenTrack
                        );

                    } catch (error) {

                        console.log(
                            "SCREEN SHARE ERROR:",
                            error
                        );

                    }

                }

            }


            setScreen(true);


            screenTrack.onended = () => {

                handleScreen();

            };

        } catch (error) {

            console.log(
                "Screen share cancelled:",
                error
            );

        }

    };


    // --------------------------------------------------
    // SEND CHAT MESSAGE
    // --------------------------------------------------

    const sendMessage = () => {

        const text = message.trim();


        if (!text) {
            return;
        }


        if (!socketRef.current) {
            return;
        }


        socketRef.current.emit(
            "chat-message",
            text,
            username
        );


        setMessages((currentMessages) => [
            ...currentMessages,
            {
                data: text,
                sender: username
            }
        ]);


        setMessage("");

    };


    // --------------------------------------------------
    // ENTER KEY CHAT
    // --------------------------------------------------

    const handleChatKeyDown = (event) => {

        if (event.key === "Enter") {

            event.preventDefault();

            sendMessage();

        }

    };


    // --------------------------------------------------
    // COPY MEETING LINK
    // --------------------------------------------------

    const copyMeetingLink = async () => {

        try {

            await navigator.clipboard.writeText(
                window.location.href
            );


            setCopySuccess(true);


            setTimeout(() => {

                setCopySuccess(false);

            }, 2000);

        } catch (error) {

            console.log(
                "COPY ERROR:",
                error
            );

        }

    };


    // --------------------------------------------------
    // SHARE MEETING
    // --------------------------------------------------

    const shareMeeting = async () => {

        const shareData = {
            title: "Video Meeting",
            text: "Join my video meeting",
            url: window.location.href
        };


        try {

            if (
                navigator.share
            ) {

                await navigator.share(
                    shareData
                );

            } else {

                await copyMeetingLink();

            }

        } catch (error) {

            console.log(
                "SHARE ERROR:",
                error
            );

        }

    };


    // --------------------------------------------------
    // END CALL
    // --------------------------------------------------

    const endCall = () => {

        if (socketRef.current) {

            socketRef.current.disconnect();

            socketRef.current = null;

        }


        Object.values(
            connections.current
        ).forEach((peer) => {

            try {
                peer.close();
            } catch (error) {
                console.log(error);
            }

        });


        connections.current = {};


        if (window.localStream) {

            window.localStream
                .getTracks()
                .forEach((track) =>
                    track.stop()
                );

            window.localStream = null;

        }


        if (window.screenStream) {

            window.screenStream
                .getTracks()
                .forEach((track) =>
                    track.stop()
                );

            window.screenStream = null;

        }


        navigate("/home");

    };


    // --------------------------------------------------
    // REMOTE VIDEO COMPONENT
    // --------------------------------------------------

    const RemoteVideo = ({ stream }) => {

        const videoRef = useRef(null);


        useEffect(() => {

            if (!videoRef.current) {
                return;
            }


            videoRef.current.srcObject =
                stream;


            const playVideo = async () => {

                try {

                    await videoRef.current.play();

                } catch (error) {

                    console.log(
                        "Remote video autoplay:",
                        error
                    );

                }

            };


            playVideo();

        }, [stream]);


        return (
            <video
                ref={videoRef}
                autoPlay
                playsInline
                className={styles.remoteVideo}
            />
        );

    };


    // ==================================================
    // LOBBY
    // ==================================================

    if (askForUsername) {

        return (
            <div
                className={
                    styles.lobbyContainer
                }
            >

                <div
                    className={
                        styles.lobbyCard
                    }
                >

                    <h2>
                        Join Meeting
                    </h2>


                    <video
                        ref={localVideoref}
                        autoPlay
                        muted
                        playsInline
                        className={
                            styles.lobbyVideo
                        }
                    />


                    <TextField
                        label="Enter your name"
                        value={username}
                        onChange={(e) =>
                            setUsername(
                                e.target.value
                            )
                        }
                        fullWidth
                    />


                    {askForUsernameError && (

                        <p
                            style={{
                                color: "red"
                            }}
                        >
                            {askForUsernameError}
                        </p>

                    )}


                    <Button
                        variant="contained"
                        onClick={connect}
                        fullWidth
                    >
                        Join Meeting
                    </Button>


                    <div
                        style={{
                            display: "flex",
                            gap: "10px",
                            marginTop: "15px",
                            justifyContent:
                                "center"
                        }}
                    >

                        <Button
                            variant="outlined"
                            onClick={
                                copyMeetingLink
                            }
                        >
                            <ContentCopyIcon />
                            &nbsp;
                            Copy Link
                        </Button>


                        <Button
                            variant="outlined"
                            onClick={
                                shareMeeting
                            }
                        >
                            Share
                        </Button>

                    </div>

                </div>

            </div>
        );

    }


    // ==================================================
    // MAIN MEETING
    // ==================================================

    return (

        <div
            className={
                styles.meetVideoContainer
            }
        >

            {/* REMOTE VIDEOS */}

            <div
                className={
                    styles.conferenceView
                }
            >

                {videos.length === 0 && (

                    <div
                        style={{
                            color: "white",
                            display: "flex",
                            alignItems: "center",
                            justifyContent:
                                "center",
                            height: "100%",
                            fontSize: "20px"
                        }}
                    >
                        Waiting for participant...
                    </div>

                )}


                {videos.map((video) => (

                    <div
                        key={
                            video.socketId
                        }
                        style={{
                            position:
                                "relative"
                        }}
                    >

                        <RemoteVideo
                            stream={
                                video.stream
                            }
                        />


                        <div
                            style={{
                                position:
                                    "absolute",
                                bottom: "15px",
                                left: "15px",
                                color: "white",
                                background:
                                    "rgba(0,0,0,.6)",
                                padding:
                                    "5px 10px",
                                borderRadius:
                                    "8px"
                            }}
                        >
                            Participant
                        </div>

                    </div>

                ))}

            </div>


            {/* LOCAL VIDEO */}

            <video
                ref={localVideoref}
                autoPlay
                muted
                playsInline
                className={
                    styles.meetUserVideo
                }
            />


            {/* CHAT */}

            {showModal && (

                <div
                    className={
                        styles.chatRoom
                    }
                >

                    <div
                        className={
                            styles.chatContainer
                        }
                    >

                        <div
                            className={
                                styles.chatHeader
                            }
                        >

                            <h3>
                                Chat
                            </h3>


                            <button
                                onClick={() =>
                                    setShowModal(
                                        false
                                    )
                                }
                            >
                                ✕
                            </button>

                        </div>


                        <div
                            className={
                                styles.chattingDisplay
                            }
                        >

                            {messages.map(
                                (msg, index) => (

                                    <div
                                        key={index}
                                        className={
                                            styles.chatMessage
                                        }
                                    >

                                        <div
                                            className={
                                                styles.chatSender
                                            }
                                        >
                                            {
                                                msg.sender
                                            }
                                        </div>


                                        <div
                                            className={
                                                styles.chatText
                                            }
                                        >
                                            {
                                                msg.data
                                            }
                                        </div>

                                    </div>

                                )
                            )}

                        </div>


                        <div
                            className={
                                styles.chattingArea
                            }
                        >

                            <TextField
                                value={message}
                                onChange={(e) =>
                                    setMessage(
                                        e.target.value
                                    )
                                }
                                onKeyDown={
                                    handleChatKeyDown
                                }
                                placeholder="Type a message..."
                                size="small"
                                fullWidth
                            />


                            <Button
                                variant="contained"
                                onClick={
                                    sendMessage
                                }
                            >
                                Send
                            </Button>

                        </div>

                    </div>

                </div>

            )}


            {/* BOTTOM CONTROLS */}

            <div
                className={
                    styles.buttonContainers
                }
            >

                <IconButton
                    onClick={
                        handleVideo
                    }
                >

                    {video ? (
                        <VideocamIcon />
                    ) : (
                        <VideocamOffIcon />
                    )}

                </IconButton>


                <IconButton
                    onClick={
                        handleAudio
                    }
                >

                    {audio ? (
                        <MicIcon />
                    ) : (
                        <MicOffIcon />
                    )}

                </IconButton>


                <IconButton
                    onClick={
                        handleScreen
                    }
                >

                    {screen ? (
                        <StopScreenShareIcon />
                    ) : (
                        <ScreenShareIcon />
                    )}

                </IconButton>


                <IconButton
                    onClick={() => {

                        setShowModal(
                            !showModal
                        );

                        if (!showModal) {
                            setNewMessages(0);
                        }

                    }}
                >

                    <ChatIcon />

                    {newMessages > 0 && (

                        <span
                            style={{
                                position:
                                    "absolute",
                                top: "0",
                                right: "0",
                                background:
                                    "red",
                                color: "white",
                                borderRadius:
                                    "50%",
                                fontSize:
                                    "11px",
                                width: "18px",
                                height: "18px",
                                display:
                                    "flex",
                                alignItems:
                                    "center",
                                justifyContent:
                                    "center"
                            }}
                        >
                            {newMessages}
                        </span>

                    )}

                </IconButton>


                <IconButton
                    onClick={
                        copyMeetingLink
                    }
                >

                    <ContentCopyIcon />

                </IconButton>


                <IconButton
                    onClick={
                        shareMeeting
                    }
                >
                    Share
                </IconButton>


                <IconButton
                    onClick={
                        endCall
                    }
                >

                    <CallEndIcon />

                </IconButton>

            </div>


            {/* COPY MESSAGE */}

            {copySuccess && (

                <div
                    style={{
                        position:
                            "fixed",
                        top: "20px",
                        left: "50%",
                        transform:
                            "translateX(-50%)",
                        background:
                            "rgba(0,0,0,.8)",
                        color: "white",
                        padding:
                            "10px 20px",
                        borderRadius:
                            "10px",
                        zIndex: 5000
                    }}
                >
                    Meeting link copied!
                </div>

            )}

        </div>

    );
}


export default VideoMeet;