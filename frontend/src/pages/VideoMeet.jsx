import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import { Badge, IconButton, TextField, Button } from "@mui/material";

import VideocamIcon from "@mui/icons-material/Videocam";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import CallEndIcon from "@mui/icons-material/CallEnd";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import ChatIcon from "@mui/icons-material/Chat";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ShareIcon from "@mui/icons-material/Share";

import styles from "../styles/videoComponent.module.css";
import server from "../environment";

const server_url = server;

const peerConfigConnections = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
  ],
};

export default function VideoMeetComponent() {
  const socketRef = useRef(null);
  const socketIdRef = useRef(null);
  const localVideoref = useRef(null);

  const connections = useRef({});
  const pendingIceCandidates = useRef({});

  const [videoAvailable, setVideoAvailable] = useState(true);
  const [audioAvailable, setAudioAvailable] = useState(true);

  const [video, setVideo] = useState(true);
  const [audio, setAudio] = useState(true);

  const [screen, setScreen] = useState(false);
  const [screenAvailable, setScreenAvailable] = useState(false);

  const [showModal, setModal] = useState(false);

  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [newMessages, setNewMessages] = useState(0);

  const [askForUsername, setAskForUsername] = useState(true);
  const [username, setUsername] = useState("");

  const [videos, setVideos] = useState([]);

  const meetingId =
    window.location.pathname.split("/meet/")[1] || "Meeting";

  /*
   * =========================
   * CLEANUP CONNECTION
   * =========================
   */

  const cleanupConnection = (id) => {
    try {
      const peer = connections.current[id];

      if (peer) {
        peer.onicecandidate = null;
        peer.ontrack = null;
        peer.oniceconnectionstatechange = null;
        peer.onconnectionstatechange = null;
        peer.close();
      }
    } catch (error) {
      console.log("CLEANUP ERROR:", error);
    }

    delete connections.current[id];
    delete pendingIceCandidates.current[id];

    setVideos((prev) =>
      prev.filter((video) => video.socketId !== id)
    );
  };

  /*
   * =========================
   * PERMISSIONS
   * =========================
   */

  useEffect(() => {
    getPermissions();

    return () => {
      Object.keys(connections.current).forEach((id) => {
        cleanupConnection(id);
      });

      try {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      } catch (error) {}

      try {
        if (window.localStream) {
          window.localStream.getTracks().forEach((track) => {
            track.stop();
          });
          window.localStream = null;
        }
      } catch (error) {}

      try {
        if (window.screenStream) {
          window.screenStream.getTracks().forEach((track) => {
            track.stop();
          });
          window.screenStream = null;
        }
      } catch (error) {}
    };
  }, []);

  const getPermissions = async () => {
    let videoPermission = false;
    let audioPermission = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });

      videoPermission = true;

      stream.getTracks().forEach((track) => track.stop());

      console.log("Video permission granted");
    } catch (error) {
      console.log("Video permission denied", error);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      audioPermission = true;

      stream.getTracks().forEach((track) => track.stop());

      console.log("Audio permission granted");
    } catch (error) {
      console.log("Audio permission denied", error);
    }

    setVideoAvailable(videoPermission);
    setAudioAvailable(audioPermission);

    setVideo(videoPermission);
    setAudio(audioPermission);

    if (navigator.mediaDevices.getDisplayMedia) {
      setScreenAvailable(true);
    }
  };

  /*
   * =========================
   * PREPARE LOCAL MEDIA
   * =========================
   */

  const prepareLocalMedia = async () => {
    try {
      if (!videoAvailable && !audioAvailable) {
        console.log("No camera or microphone available");
        return false;
      }

      /*
       * If stream already exists, use it.
       */
      if (
        window.localStream &&
        window.localStream.getTracks().length > 0
      ) {
        console.log("Using existing local stream");

        if (localVideoref.current) {
          localVideoref.current.srcObject = window.localStream;
        }

        return true;
      }

      /*
       * Otherwise create stream before socket connection.
       */
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoAvailable,
        audio: audioAvailable,
      });

      window.localStream = stream;

      console.log(
        "LOCAL STREAM READY:",
        stream.getTracks().map((track) => track.kind)
      );

      if (localVideoref.current) {
        localVideoref.current.srcObject = stream;
      }

      return true;
    } catch (error) {
      console.log("LOCAL MEDIA ERROR:", error);
      return false;
    }
  };

  /*
   * =========================
   * CREATE PEER CONNECTION
   * =========================
   */

  const createPeerConnection = (remoteId) => {
    if (connections.current[remoteId]) {
      return connections.current[remoteId];
    }

    console.log("Creating peer connection:", remoteId);

    const peerConnection = new RTCPeerConnection(
      peerConfigConnections
    );

    connections.current[remoteId] = peerConnection;
    pendingIceCandidates.current[remoteId] = [];

    /*
     * ADD LOCAL TRACKS
     *
     * This is done when peer is created.
     */
    if (
      window.localStream &&
      window.localStream.getTracks().length > 0
    ) {
      window.localStream.getTracks().forEach((track) => {
        try {
          peerConnection.addTrack(
            track,
            window.localStream
          );

          console.log(
            "LOCAL TRACK ADDED:",
            track.kind,
            "to",
            remoteId
          );
        } catch (error) {
          console.log("ADD TRACK ERROR:", error);
        }
      });
    } else {
      console.log(
        "WARNING: localStream not available while creating peer"
      );
    }

    /*
     * ICE CANDIDATE
     */

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;

      if (!socketRef.current) return;

      socketRef.current.emit(
        "signal",
        remoteId,
        JSON.stringify({
          ice: event.candidate,
        })
      );
    };

    /*
     * ICE CONNECTION STATE
     */

    peerConnection.oniceconnectionstatechange = () => {
      console.log(
        "ICE STATE",
        remoteId,
        ":",
        peerConnection.iceConnectionState
      );

      if (
        peerConnection.iceConnectionState === "failed"
      ) {
        console.log(
          "ICE connection failed:",
          remoteId
        );
      }

      if (
        peerConnection.iceConnectionState === "closed"
      ) {
        cleanupConnection(remoteId);
      }
    };

    /*
     * CONNECTION STATE
     */

    peerConnection.onconnectionstatechange = () => {
      console.log(
        "CONNECTION STATE",
        remoteId,
        ":",
        peerConnection.connectionState
      );
    };

    /*
     * REMOTE TRACK
     */

    peerConnection.ontrack = (event) => {
      console.log(
        "REMOTE TRACK RECEIVED:",
        remoteId,
        event.track.kind
      );

      let remoteStream;

      if (event.streams && event.streams[0]) {
        remoteStream = event.streams[0];
      } else {
        remoteStream = new MediaStream();

        const existingVideo = videos.find(
          (item) => item.socketId === remoteId
        );

        if (existingVideo && existingVideo.stream) {
          remoteStream = existingVideo.stream;
        }

        remoteStream.addTrack(event.track);
      }

      setVideos((prevVideos) => {
        const existing = prevVideos.find(
          (item) => item.socketId === remoteId
        );

        if (existing) {
          return prevVideos.map((item) =>
            item.socketId === remoteId
              ? {
                  ...item,
                  stream: remoteStream,
                }
              : item
          );
        }

        return [
          ...prevVideos,
          {
            socketId: remoteId,
            stream: remoteStream,
          },
        ];
      });
    };

    return peerConnection;
  };

  /*
   * =========================
   * CREATE OFFER
   * =========================
   */

  const createOfferFor = async (remoteId) => {
    const peerConnection =
      connections.current[remoteId];

    if (!peerConnection) {
      console.log(
        "No peer connection for offer:",
        remoteId
      );
      return;
    }

    try {
      if (
        peerConnection.signalingState !== "stable"
      ) {
        console.log(
          "Peer not stable, offer skipped:",
          remoteId,
          peerConnection.signalingState
        );
        return;
      }

      console.log(
        "Creating offer for:",
        remoteId
      );

      const offer =
        await peerConnection.createOffer();

      if (
        peerConnection.signalingState !== "stable"
      ) {
        return;
      }

      await peerConnection.setLocalDescription(
        offer
      );

      if (
        !peerConnection.localDescription
      ) {
        return;
      }

      socketRef.current.emit(
        "signal",
        remoteId,
        JSON.stringify({
          sdp: peerConnection.localDescription,
        })
      );

      console.log(
        "OFFER SENT TO:",
        remoteId
      );
    } catch (error) {
      console.log(
        "CREATE OFFER ERROR:",
        error
      );
    }
  };

  /*
   * =========================
   * SOCKET CONNECTION
   * =========================
   */

  const connectToSocketServer = () => {
    if (socketRef.current) {
      return;
    }

    console.log(
      "Connecting socket to:",
      server_url
    );

    socketRef.current = io(server_url, {
      secure: true,
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => {
      socketIdRef.current =
        socketRef.current.id;

      console.log(
        "SOCKET CONNECTED:",
        socketIdRef.current
      );

      /*
       * JOIN MEETING
       */

      socketRef.current.emit(
        "join-call",
        window.location.href
      );

      /*
       * CHAT
       */

      socketRef.current.on(
        "chat-message",
        addMessage
      );

      /*
       * USER LEFT
       */

      socketRef.current.on(
        "user-left",
        (id) => {
          console.log(
            "USER LEFT:",
            id
          );

          cleanupConnection(id);
        }
      );

      /*
       * USER JOINED
       */

      socketRef.current.on(
        "user-joined",
        async (id, clients) => {
          console.log(
            "USER JOINED:",
            id,
            clients
          );

          /*
           * Create connection with every
           * other participant.
           */

          clients.forEach((socketListId) => {
            if (
              socketListId ===
              socketIdRef.current
            ) {
              return;
            }

            createPeerConnection(
              socketListId
            );
          });

          /*
           * Only NEW participant creates
           * offers.
           */

          if (
            id === socketIdRef.current
          ) {
            const remoteIds =
              Object.keys(
                connections.current
              );

            for (const remoteId of remoteIds) {
              if (
                remoteId ===
                socketIdRef.current
              ) {
                continue;
              }

              await createOfferFor(
                remoteId
              );
            }
          }
        }
      );
    });

    /*
     * SIGNAL
     */

    socketRef.current.on(
      "signal",
      gotMessageFromServer
    );

    socketRef.current.on(
      "connect_error",
      (error) => {
        console.log(
          "SOCKET CONNECT ERROR:",
          error
        );
      }
    );
  };

  /*
   * =========================
   * RECEIVE SIGNAL
   * =========================
   */

  const gotMessageFromServer = async (
    fromId,
    message
  ) => {
    try {
      const signal = JSON.parse(message);

      if (
        fromId === socketIdRef.current
      ) {
        return;
      }

      let peerConnection =
        connections.current[fromId];

      if (!peerConnection) {
        peerConnection =
          createPeerConnection(fromId);
      }

      /*
       * =========================
       * SDP
       * =========================
       */

      if (signal.sdp) {
        const description =
          new RTCSessionDescription(
            signal.sdp
          );

        /*
         * ANSWER
         */

        if (
          description.type === "answer"
        ) {
          if (
            peerConnection.signalingState !==
            "have-local-offer"
          ) {
            console.log(
              "Ignoring unexpected answer from:",
              fromId
            );
            return;
          }

          await peerConnection.setRemoteDescription(
            description
          );

          console.log(
            "REMOTE ANSWER SET:",
            fromId
          );
        }

        /*
         * OFFER
         */

        if (
          description.type === "offer"
        ) {
          if (
            peerConnection.signalingState !==
            "stable"
          ) {
            console.log(
              "Ignoring offer because peer is not stable:",
              fromId
            );
            return;
          }

          await peerConnection.setRemoteDescription(
            description
          );

          console.log(
            "REMOTE OFFER SET:",
            fromId
          );

          /*
           * Add pending ICE
           */

          const pending =
            pendingIceCandidates.current[
              fromId
            ] || [];

          for (const candidate of pending) {
            try {
              await peerConnection.addIceCandidate(
                candidate
              );
            } catch (error) {
              console.log(
                "PENDING ICE ERROR:",
                error
              );
            }
          }

          pendingIceCandidates.current[
            fromId
          ] = [];

          /*
           * CREATE ANSWER
           */

          const answer =
            await peerConnection.createAnswer();

          await peerConnection.setLocalDescription(
            answer
          );

          if (
            peerConnection.localDescription &&
            socketRef.current
          ) {
            socketRef.current.emit(
              "signal",
              fromId,
              JSON.stringify({
                sdp:
                  peerConnection.localDescription,
              })
            );

            console.log(
              "ANSWER SENT TO:",
              fromId
            );
          }
        }
      }

      /*
       * =========================
       * ICE
       * =========================
       */

      if (signal.ice) {
        const candidate =
          new RTCIceCandidate(
            signal.ice
          );

        if (
          peerConnection.remoteDescription
        ) {
          try {
            await peerConnection.addIceCandidate(
              candidate
            );
          } catch (error) {
            console.log(
              "ICE ERROR:",
              error
            );
          }
        } else {
          if (
            !pendingIceCandidates.current[
              fromId
            ]
          ) {
            pendingIceCandidates.current[
              fromId
            ] = [];
          }

          pendingIceCandidates.current[
            fromId
          ].push(candidate);
        }
      }
    } catch (error) {
      console.log(
        "SIGNAL ERROR:",
        error
      );
    }
  };

  /*
   * =========================
   * CAMERA
   * =========================
   */

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

  /*
   * =========================
   * MICROPHONE
   * =========================
   */

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

  /*
   * =========================
   * SCREEN SHARE
   * =========================
   */

  const startScreenShare = async () => {
    try {
      if (
        !navigator.mediaDevices.getDisplayMedia
      ) {
        alert(
          "Screen sharing is not supported."
        );

        setScreen(false);
        return;
      }

      const stream =
        await navigator.mediaDevices.getDisplayMedia(
          {
            video: true,
            audio: true,
          }
        );

      const screenTrack =
        stream.getVideoTracks()[0];

      if (localVideoref.current) {
        localVideoref.current.srcObject =
          stream;
      }

      Object.keys(
        connections.current
      ).forEach((id) => {
        const peerConnection =
          connections.current[id];

        if (!peerConnection) return;

        const sender =
          peerConnection
            .getSenders()
            .find(
              (sender) =>
                sender.track &&
                sender.track.kind ===
                  "video"
            );

        if (sender) {
          sender.replaceTrack(
            screenTrack
          );
        }
      });

      window.screenStream = stream;

      screenTrack.onended = () => {
        setScreen(false);
      };
    } catch (error) {
      console.log(
        "SCREEN SHARE ERROR:",
        error
      );

      setScreen(false);
    }
  };

  const stopScreenShare = async () => {
    try {
      if (window.screenStream) {
        window.screenStream
          .getTracks()
          .forEach((track) => {
            track.stop();
          });

        window.screenStream = null;
      }

      const cameraStream =
        await navigator.mediaDevices.getUserMedia(
          {
            video:
              video && videoAvailable,
            audio:
              audio && audioAvailable,
          }
        );

      window.localStream =
        cameraStream;

      if (localVideoref.current) {
        localVideoref.current.srcObject =
          cameraStream;
      }

      const cameraTrack =
        cameraStream.getVideoTracks()[0];

      Object.keys(
        connections.current
      ).forEach((id) => {
        const peerConnection =
          connections.current[id];

        if (!peerConnection) return;

        const sender =
          peerConnection
            .getSenders()
            .find(
              (sender) =>
                sender.track &&
                sender.track.kind ===
                  "video"
            );

        if (
          sender &&
          cameraTrack
        ) {
          sender.replaceTrack(
            cameraTrack
          );
        }
      });
    } catch (error) {
      console.log(
        "CAMERA RESTORE ERROR:",
        error
      );
    }
  };

  useEffect(() => {
    if (screen) {
      startScreenShare();
    } else if (
      window.screenStream
    ) {
      stopScreenShare();
    }
  }, [screen]);

  /*
   * =========================
   * END CALL
   * =========================
   */

  const handleEndCall = () => {
    try {
      if (window.localStream) {
        window.localStream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
      }
    } catch (error) {}

    try {
      if (window.screenStream) {
        window.screenStream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
      }
    } catch (error) {}

    Object.keys(
      connections.current
    ).forEach((id) => {
      cleanupConnection(id);
    });

    try {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    } catch (error) {}

    window.location.href = "/";
  };

  /*
   * =========================
   * CHAT
   * =========================
   */

  const openChat = () => {
    setModal(true);
    setNewMessages(0);
  };

  const closeChat = () => {
    setModal(false);
  };

  const addMessage = (
    data,
    sender,
    socketIdSender
  ) => {
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        sender:
          sender || "Participant",
        data,
      },
    ]);

    if (
      socketIdSender !==
      socketIdRef.current
    ) {
      setNewMessages(
        (prev) => prev + 1
      );
    }
  };

  const sendMessage = () => {
    const text = message.trim();

    if (!text) return;

    if (
      !socketRef.current ||
      !socketRef.current.connected
    ) {
      console.log(
        "Socket not connected"
      );
      return;
    }

    socketRef.current.emit(
      "chat-message",
      text,
      username
    );

    setMessage("");
  };

  /*
   * =========================
   * COPY LINK
   * =========================
   */

  const copyMeetingLink = async () => {
    try {
      await navigator.clipboard.writeText(
        window.location.href
      );

      alert(
        "Meeting link copied!"
      );
    } catch (error) {
      console.log(
        "COPY ERROR:",
        error
      );
    }
  };

  /*
   * =========================
   * SHARE LINK
   * =========================
   */

  const shareMeetingLink = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title:
            "Join my Velnoxa meeting",
          text:
            "Join my video meeting",
          url:
            window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(
          window.location.href
        );

        alert(
          "Sharing is not supported. Meeting link copied!"
        );
      }
    } catch (error) {
      console.log(
        "SHARE ERROR:",
        error
      );
    }
  };

  /*
   * =========================
   * CONNECT / JOIN
   * =========================
   */

  const connect = async () => {
    if (!username.trim()) {
      alert(
        "Please enter your name"
      );
      return;
    }

    /*
     * VERY IMPORTANT:
     * Media must be ready BEFORE
     * socket / peer connection starts.
     */

    const mediaReady =
      await prepareLocalMedia();

    if (!mediaReady) {
      alert(
        "Camera or microphone could not be started."
      );
      return;
    }

    setAskForUsername(false);

    connectToSocketServer();
  };

  return (
    <div>
      {askForUsername ? (
        /*
         * =========================
         * LOBBY
         * =========================
         */
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "650px",
              textAlign: "center",
            }}
          >
            <h1>Velnoxa</h1>

            <h2>Join Meeting</h2>

            <p>
              Meeting ID:{" "}
              <strong>
                {meetingId}
              </strong>
            </p>

            <div
              style={{
                margin: "20px auto",
                maxWidth: "500px",
              }}
            >
              <video
                ref={
                  localVideoref
                }
                autoPlay
                muted
                playsInline
                style={{
                  width: "100%",
                  maxHeight:
                    "350px",
                  borderRadius:
                    "12px",
                  background:
                    "#111",
                  objectFit:
                    "cover",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent:
                  "center",
                gap: "10px",
                flexWrap:
                  "wrap",
              }}
            >
              <TextField
                id="username"
                label="Your Name"
                value={username}
                onChange={(e) =>
                  setUsername(
                    e.target.value
                  )
                }
                variant="outlined"
                onKeyDown={(e) => {
                  if (
                    e.key ===
                    "Enter"
                  ) {
                    connect();
                  }
                }}
              />

              <Button
                variant="contained"
                onClick={
                  connect
                }
                style={{
                  minHeight:
                    "56px",
                }}
              >
                Join Meeting
              </Button>
            </div>

            <div
              style={{
                marginTop:
                  "20px",
                display: "flex",
                justifyContent:
                  "center",
                gap: "10px",
                flexWrap:
                  "wrap",
              }}
            >
              <Button
                variant="outlined"
                onClick={
                  copyMeetingLink
                }
              >
                <ContentCopyIcon
                  style={{
                    marginRight:
                      "5px",
                  }}
                />
                Copy Link
              </Button>

              <Button
                variant="outlined"
                onClick={
                  shareMeetingLink
                }
              >
                <ShareIcon
                  style={{
                    marginRight:
                      "5px",
                  }}
                />
                Share
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /*
         * =========================
         * VIDEO MEETING
         * =========================
         */
        <div
          className={
            styles.meetVideoContainer
          }
        >
          {/* TOP BAR */}

          <div
            style={{
              position:
                "absolute",
              top: "10px",
              left: "15px",
              right: "15px",
              zIndex: 3000,
              display: "flex",
              alignItems:
                "center",
              justifyContent:
                "space-between",
              color: "white",
            }}
          >
            <div>
              <strong>
                Velnoxa
              </strong>

              <div
                style={{
                  fontSize:
                    "12px",
                  opacity: 0.8,
                }}
              >
                Meeting:{" "}
                {meetingId}
              </div>
            </div>

            <div
              style={{
                display:
                  "flex",
                gap: "5px",
              }}
            >
              <IconButton
                onClick={
                  copyMeetingLink
                }
                style={{
                  color:
                    "white",
                }}
              >
                <ContentCopyIcon />
              </IconButton>

              <IconButton
                onClick={
                  shareMeetingLink
                }
                style={{
                  color:
                    "white",
                }}
              >
                <ShareIcon />
              </IconButton>
            </div>
          </div>

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
                  <h2>Chat</h2>

                  <Button
                    onClick={
                      closeChat
                    }
                    size="small"
                  >
                    Close
                  </Button>
                </div>

                <div
                  className={
                    styles.chattingDisplay
                  }
                >
                  {messages.length >
                  0 ? (
                    messages.map(
                      (
                        item,
                        index
                      ) => (
                        <div
                          key={
                            index
                          }
                          className={
                            styles.chatMessage
                          }
                        >
                          <p
                            className={
                              styles.chatSender
                            }
                          >
                            {
                              item.sender
                            }
                          </p>

                          <p
                            className={
                              styles.chatText
                            }
                          >
                            {
                              item.data
                            }
                          </p>
                        </div>
                      )
                    )
                  ) : (
                    <p>
                      No Messages Yet
                    </p>
                  )}
                </div>

                <div
                  className={
                    styles.chattingArea
                  }
                >
                  <TextField
                    value={
                      message
                    }
                    onChange={(e) =>
                      setMessage(
                        e.target.value
                      )
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key ===
                        "Enter"
                      ) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    label="Enter Your Chat"
                    variant="outlined"
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

          {/* CONTROL BAR */}

          <div
            className={
              styles.buttonContainers
            }
          >
            <IconButton
              onClick={
                handleVideo
              }
              style={{
                color: "white",
              }}
            >
              {video ? (
                <VideocamIcon />
              ) : (
                <VideocamOffIcon />
              )}
            </IconButton>

            <IconButton
              onClick={
                handleEndCall
              }
              style={{
                color: "red",
              }}
            >
              <CallEndIcon />
            </IconButton>

            <IconButton
              onClick={
                handleAudio
              }
              style={{
                color: "white",
              }}
            >
              {audio ? (
                <MicIcon />
              ) : (
                <MicOffIcon />
              )}
            </IconButton>

            {screenAvailable && (
              <IconButton
                onClick={() =>
                  setScreen(
                    (prev) =>
                      !prev
                  )
                }
                style={{
                  color:
                    "white",
                }}
              >
                {screen ? (
                  <ScreenShareIcon />
                ) : (
                  <StopScreenShareIcon />
                )}
              </IconButton>
            )}

            <IconButton
              onClick={
                copyMeetingLink
              }
              style={{
                color: "white",
              }}
            >
              <ContentCopyIcon />
            </IconButton>

            <IconButton
              onClick={
                shareMeetingLink
              }
              style={{
                color: "white",
              }}
            >
              <ShareIcon />
            </IconButton>

            <Badge
              badgeContent={
                newMessages >
                0
                  ? newMessages
                  : null
              }
              max={999}
              color="error"
            >
              <IconButton
                onClick={() => {
                  if (
                    showModal
                  ) {
                    closeChat();
                  } else {
                    openChat();
                  }
                }}
                style={{
                  color:
                    "white",
                }}
              >
                <ChatIcon />
              </IconButton>
            </Badge>
          </div>

          {/* LOCAL VIDEO */}

          <video
            className={
              styles.meetUserVideo
            }
            ref={
              localVideoref
            }
            autoPlay
            muted
            playsInline
          />

          {/* REMOTE VIDEOS */}

          <div
            className={
              styles.conferenceView
            }
            style={{
              display:
                "grid",
              gridTemplateColumns:
                videos.length <=
                1
                  ? "1fr"
                  : videos.length <=
                    4
                  ? "1fr 1fr"
                  : "repeat(auto-fit,minmax(300px,1fr))",
              gap: "20px",
              padding: "20px",
            }}
          >
            {videos.map(
              (video) => (
                <RemoteVideo
                  key={
                    video.socketId
                  }
                  stream={
                    video.stream
                  }
                  socketId={
                    video.socketId
                  }
                />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/*
 * =========================
 * REMOTE VIDEO COMPONENT
 * =========================
 */

function RemoteVideo({
  stream,
  socketId,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current || !stream) {
      return;
    }

    const videoElement =
      videoRef.current;

    videoElement.srcObject =
      stream;

    console.log(
      "REMOTE STREAM ATTACHED:",
      socketId,
      stream.getTracks().map(
        (track) =>
          `${track.kind}:${track.readyState}`
      )
    );

    const playVideo = async () => {
      try {
        await videoElement.play();

        console.log(
          "REMOTE VIDEO PLAYING:",
          socketId
        );
      } catch (error) {
        console.log(
          "REMOTE VIDEO PLAY ERROR:",
          socketId,
          error
        );
      }
    };

    if (
      videoElement.readyState >= 1
    ) {
      playVideo();
    } else {
      videoElement.onloadedmetadata =
        playVideo;
    }

    return () => {
      videoElement.onloadedmetadata =
        null;
    };
  }, [stream, socketId]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minHeight: "200px",
        background: "#111",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={
          styles.remoteVideo
        }
      />

      <div
        style={{
          position:
            "absolute",
          bottom: "10px",
          left: "10px",
          background:
            "rgba(0,0,0,0.6)",
          color: "white",
          padding: "5px 10px",
          borderRadius: "6px",
          fontSize: "13px",
        }}
      >
        Participant
      </div>
    </div>
  );
}