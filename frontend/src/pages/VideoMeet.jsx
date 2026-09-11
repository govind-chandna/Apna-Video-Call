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

  const [video, setVideo] = useState();
  const [audio, setAudio] = useState();

  const [screen, setScreen] = useState();
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
   * CLEANUP
   * =========================
   */

  const cleanupConnection = (id) => {
    try {
      if (connections.current[id]) {
        connections.current[id].onicecandidate = null;
        connections.current[id].ontrack = null;
        connections.current[id].close();
      }
    } catch (error) {}

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
        }
      } catch (error) {}

      try {
        if (window.screenStream) {
          window.screenStream.getTracks().forEach((track) => {
            track.stop();
          });
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
      console.log("Video permission denied");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      audioPermission = true;

      stream.getTracks().forEach((track) => track.stop());

      console.log("Audio permission granted");
    } catch (error) {
      console.log("Audio permission denied");
    }

    setVideoAvailable(videoPermission);
    setAudioAvailable(audioPermission);

    if (navigator.mediaDevices.getDisplayMedia) {
      setScreenAvailable(true);
    }

    if (videoPermission || audioPermission) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoPermission,
          audio: audioPermission,
        });

        window.localStream = stream;

        if (localVideoref.current) {
          localVideoref.current.srcObject = stream;
        }
      } catch (error) {
        console.log("Initial media error:", error);
      }
    }
  };

  /*
   * =========================
   * START MEDIA
   * =========================
   */

  const getMedia = () => {
    setVideo(videoAvailable);
    setAudio(audioAvailable);

    connectToSocketServer();
  };

  /*
   * =========================
   * MEDIA EFFECT
   * =========================
   */

  useEffect(() => {
    if (video !== undefined && audio !== undefined) {
      getUserMedia();
    }
  }, [video, audio]);

  const getUserMedia = async () => {
    try {
      const oldStream = window.localStream;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: video && videoAvailable,
        audio: audio && audioAvailable,
      });

      window.localStream = stream;

      if (localVideoref.current) {
        localVideoref.current.srcObject = stream;
      }

      /*
       * IMPORTANT:
       * Do NOT addTrack again.
       * Replace existing tracks instead.
       */

      Object.keys(connections.current).forEach((id) => {
        const peerConnection = connections.current[id];

        if (!peerConnection) return;

        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];

        const videoSender = peerConnection
          .getSenders()
          .find(
            (sender) =>
              sender.track &&
              sender.track.kind === "video"
          );

        const audioSender = peerConnection
          .getSenders()
          .find(
            (sender) =>
              sender.track &&
              sender.track.kind === "audio"
          );

        if (videoSender) {
          videoSender.replaceTrack(videoTrack || null);
        }

        if (audioSender) {
          audioSender.replaceTrack(audioTrack || null);
        }
      });

      if (oldStream) {
        oldStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
    } catch (error) {
      console.log("MEDIA ERROR:", error);
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

    const peerConnection = new RTCPeerConnection(
      peerConfigConnections
    );

    connections.current[remoteId] = peerConnection;

    pendingIceCandidates.current[remoteId] = [];

    /*
     * ICE
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
     * REMOTE VIDEO
     */

    peerConnection.ontrack = (event) => {
      if (!event.streams || !event.streams[0]) {
        return;
      }

      const remoteStream = event.streams[0];

      setVideos((prevVideos) => {
        const existing = prevVideos.find(
          (video) => video.socketId === remoteId
        );

        if (existing) {
          return prevVideos.map((video) =>
            video.socketId === remoteId
              ? {
                  ...video,
                  stream: remoteStream,
                }
              : video
          );
        }

        return [
          ...prevVideos,
          {
            socketId: remoteId,
            stream: remoteStream,
            autoplay: true,
            playsinline: true,
          },
        ];
      });
    };

    /*
     * ADD CURRENT LOCAL TRACKS ONLY ONCE
     */

    if (window.localStream) {
      window.localStream.getTracks().forEach((track) => {
        try {
          peerConnection.addTrack(
            track,
            window.localStream
          );
        } catch (error) {
          console.log("ADD TRACK ERROR:", error);
        }
      });
    }

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
      return;
    }

    try {
      if (
        peerConnection.signalingState !==
        "stable"
      ) {
        return;
      }

      const offer =
        await peerConnection.createOffer();

      if (
        peerConnection.signalingState !==
        "stable"
      ) {
        return;
      }

      await peerConnection.setLocalDescription(
        offer
      );

      if (!peerConnection.localDescription) {
        return;
      }

      socketRef.current.emit(
        "signal",
        remoteId,
        JSON.stringify({
          sdp: peerConnection.localDescription,
        })
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
   * SOCKET.IO
   * =========================
   */

  const connectToSocketServer = () => {
    if (socketRef.current) {
      return;
    }

    socketRef.current = io.connect(server_url, {
      secure: true,
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => {
      socketIdRef.current =
        socketRef.current.id;

      socketRef.current.emit(
        "join-call",
        window.location.href
      );

      socketRef.current.on(
        "chat-message",
        addMessage
      );

      socketRef.current.on(
        "user-left",
        (id) => {
          cleanupConnection(id);
        }
      );

      socketRef.current.on(
        "user-joined",
        async (id, clients) => {
          /*
           * Create peer connections
           * for all other users.
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
           * ONLY the newly joined user
           * creates offers.
           *
           * This prevents both users from
           * creating offers simultaneously.
           */

          if (
            id === socketIdRef.current
          ) {
            for (
              const remoteId of Object.keys(
                connections.current
              )
            ) {
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

    socketRef.current.on(
      "signal",
      gotMessageFromServer
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
       * SDP
       */

      if (signal.sdp) {
        const description =
          new RTCSessionDescription(
            signal.sdp
          );

        /*
         * Ignore duplicate answers.
         */

        if (
          description.type === "answer" &&
          peerConnection.signalingState !==
            "have-local-offer"
        ) {
          return;
        }

        /*
         * Ignore duplicate offers when
         * already negotiating.
         */

        if (
          description.type === "offer" &&
          peerConnection.signalingState !==
            "stable"
        ) {
          return;
        }

        await peerConnection.setRemoteDescription(
          description
        );

        /*
         * Add pending ICE candidates.
         */

        if (
          pendingIceCandidates.current[
            fromId
          ]
        ) {
          for (const candidate of
            pendingIceCandidates.current[
              fromId
            ]) {
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
        }

        /*
         * If offer received,
         * create answer.
         */

        if (
          description.type === "offer"
        ) {
          const answer =
            await peerConnection.createAnswer();

          await peerConnection.setLocalDescription(
            answer
          );

          if (
            peerConnection.localDescription
          ) {
            socketRef.current.emit(
              "signal",
              fromId,
              JSON.stringify({
                sdp:
                  peerConnection.localDescription,
              })
            );
          }
        }
      }

      /*
       * ICE
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
    setVideo((prev) => !prev);
  };

  /*
   * =========================
   * MICROPHONE
   * =========================
   */

  const handleAudio = () => {
    setAudio((prev) => !prev);
  };

  /*
   * =========================
   * SCREEN SHARE
   * =========================
   */

  useEffect(() => {
    if (screen === undefined) return;

    if (screen) {
      startScreenShare();
    } else {
      stopScreenShare();
    }
  }, [screen]);

  const startScreenShare = async () => {
    try {
      if (
        !navigator.mediaDevices
          .getDisplayMedia
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

    if (!socketRef.current) {
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
   * CONNECT
   * =========================
   */

  const connect = () => {
    if (!username.trim()) {
      alert(
        "Please enter your name"
      );
      return;
    }

    setAskForUsername(false);
    getMedia();
  };

  /*
   * =========================
   * SILENCE TRACK
   * =========================
   */

  const silence = () => {
    const ctx =
      new AudioContext();

    const oscillator =
      ctx.createOscillator();

    const dst =
      oscillator.connect(
        ctx.createMediaStreamDestination()
      );

    oscillator.start();
    ctx.resume();

    return Object.assign(
      dst.stream.getAudioTracks()[0],
      {
        enabled: false,
      }
    );
  };

  /*
   * =========================
   * BLACK VIDEO TRACK
   * =========================
   */

  const black = ({
    width = 640,
    height = 480,
  } = {}) => {
    const canvas =
      Object.assign(
        document.createElement(
          "canvas"
        ),
        {
          width,
          height,
        }
      );

    const context =
      canvas.getContext("2d");

    context.fillRect(
      0,
      0,
      width,
      height
    );

    const stream =
      canvas.captureStream();

    return Object.assign(
      stream.getVideoTracks()[0],
      {
        enabled: false,
      }
    );
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
                <div
                  key={
                    video.socketId
                  }
                  style={{
                    position:
                      "relative",
                    width:
                      "100%",
                    minHeight:
                      "200px",
                    background:
                      "#111",
                    borderRadius:
                      "12px",
                    overflow:
                      "hidden",
                  }}
                >
                  <video
                    data-socket={
                      video.socketId
                    }
                    ref={(ref) => {
                      if (
                        ref &&
                        video.stream
                      ) {
                        ref.srcObject =
                          video.stream;

                        ref.onloadedmetadata =
                          () => {
                            ref
                              .play()
                              .catch(
                                (
                                  error
                                ) =>
                                  console.log(
                                    "VIDEO PLAY ERROR:",
                                    error
                                  )
                              );
                          };
                      }
                    }}
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
                      bottom:
                        "10px",
                      left: "10px",
                      background:
                        "rgba(0,0,0,0.6)",
                      color:
                        "white",
                      padding:
                        "5px 10px",
                      borderRadius:
                        "6px",
                      fontSize:
                        "13px",
                    }}
                  >
                    Participant
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}