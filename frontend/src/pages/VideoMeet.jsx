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

  const videoRef = useRef([]);

  const [videoAvailable, setVideoAvailable] = useState(true);
  const [audioAvailable, setAudioAvailable] = useState(true);

  const [video, setVideo] = useState();
  const [audio, setAudio] = useState();
  const [screen, setScreen] = useState();

  const [showModal, setModal] = useState(false);
  const [screenAvailable, setScreenAvailable] = useState(false);

  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [newMessages, setNewMessages] = useState(0);

  const [askForUsername, setAskForUsername] = useState(true);
  const [username, setUsername] = useState("");

  const [videos, setVideos] = useState([]);

  const meetingId =
    window.location.pathname.split("/meet/")[1] || "Meeting";

  /*
   * GET PERMISSIONS
   */
  useEffect(() => {
    getPermissions();

    return () => {
      try {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      } catch (e) {}

      try {
        if (window.localStream) {
          window.localStream.getTracks().forEach((track) => {
            track.stop();
          });
        }
      } catch (e) {}
    };
  }, []);

  /*
   * CAMERA + MICROPHONE PERMISSION
   */
  const getPermissions = async () => {
    try {
      let videoPermission = false;
      let audioPermission = false;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });

        videoPermission = true;

        stream.getTracks().forEach((track) => {
          track.stop();
        });

        console.log("Video permission granted");
      } catch (error) {
        console.log("Video permission denied");
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        audioPermission = true;

        stream.getTracks().forEach((track) => {
          track.stop();
        });

        console.log("Audio permission granted");
      } catch (error) {
        console.log("Audio permission denied");
      }

      setVideoAvailable(videoPermission);
      setAudioAvailable(audioPermission);

      if (navigator.mediaDevices.getDisplayMedia) {
        setScreenAvailable(true);
      } else {
        setScreenAvailable(false);
      }

      if (videoPermission || audioPermission) {
        try {
          const userMediaStream =
            await navigator.mediaDevices.getUserMedia({
              video: videoPermission,
              audio: audioPermission,
            });

          window.localStream = userMediaStream;

          if (localVideoref.current) {
            localVideoref.current.srcObject = userMediaStream;
          }
        } catch (error) {
          console.log("Initial media error:", error);
        }
      }
    } catch (error) {
      console.log("PERMISSION ERROR:", error);
    }
  };

  /*
   * START MEDIA
   */
  const getMedia = () => {
    setVideo(videoAvailable);
    setAudio(audioAvailable);

    connectToSocketServer();
  };

  /*
   * GET USER MEDIA
   */
  useEffect(() => {
    if (video !== undefined && audio !== undefined) {
      getUserMedia();
    }
  }, [video, audio]);

  const getUserMedia = () => {
    if (
      (video && videoAvailable) ||
      (audio && audioAvailable)
    ) {
      navigator.mediaDevices
        .getUserMedia({
          video: video && videoAvailable,
          audio: audio && audioAvailable,
        })
        .then(getUserMediaSuccess)
        .catch((error) => {
          console.log("MEDIA ERROR:", error);
        });
    } else {
      try {
        if (localVideoref.current?.srcObject) {
          localVideoref.current.srcObject
            .getTracks()
            .forEach((track) => track.stop());
        }
      } catch (e) {}
    }
  };

  /*
   * USER MEDIA SUCCESS
   */
  const getUserMediaSuccess = (stream) => {
    try {
      if (window.localStream) {
        window.localStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
    } catch (e) {}

    window.localStream = stream;

    if (localVideoref.current) {
      localVideoref.current.srcObject = stream;
    }

    for (let id in connections.current) {
      if (id === socketIdRef.current) continue;

      stream.getTracks().forEach((track) => {
        try {
          connections.current[id].addTrack(
            track,
            stream
          );
        } catch (e) {}
      });

      connections.current[id]
        .createOffer()
        .then((description) => {
          return connections.current[id].setLocalDescription(
            description
          );
        })
        .then(() => {
          socketRef.current.emit(
            "signal",
            id,
            JSON.stringify({
              sdp: connections.current[id].localDescription,
            })
          );
        })
        .catch((e) => console.log("OFFER ERROR:", e));
    }

    stream.getTracks().forEach((track) => {
      track.onended = () => {
        setVideo(false);
        setAudio(false);

        try {
          stream.getTracks().forEach((track) => track.stop());
        } catch (e) {}

        const blackSilence = () =>
          new MediaStream([black(), silence()]);

        window.localStream = blackSilence();

        if (localVideoref.current) {
          localVideoref.current.srcObject =
            window.localStream;
        }
      };
    });
  };

  /*
   * SCREEN SHARE
   */
  useEffect(() => {
    if (screen !== undefined) {
      if (screen) {
        startScreenShare();
      } else {
        stopScreenShare();
      }
    }
  }, [screen]);

  const startScreenShare = async () => {
    try {
      if (!navigator.mediaDevices.getDisplayMedia) {
        alert("Screen sharing is not supported.");
        setScreen(false);
        return;
      }

      const stream =
        await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

      const screenTrack = stream.getVideoTracks()[0];

      if (localVideoref.current) {
        localVideoref.current.srcObject = stream;
      }

      for (let id in connections.current) {
        const sender =
          connections.current[id]
            .getSenders()
            .find(
              (sender) =>
                sender.track &&
                sender.track.kind === "video"
            );

        if (sender) {
          await sender.replaceTrack(screenTrack);
        }
      }

      screenTrack.onended = () => {
        setScreen(false);
      };

      window.screenStream = stream;
    } catch (error) {
      console.log("SCREEN SHARE ERROR:", error);
      setScreen(false);
    }
  };

  const stopScreenShare = async () => {
    try {
      if (window.screenStream) {
        window.screenStream.getTracks().forEach((track) => {
          track.stop();
        });

        window.screenStream = null;
      }

      const cameraStream =
        await navigator.mediaDevices.getUserMedia({
          video: video && videoAvailable,
          audio: audio && audioAvailable,
        });

      window.localStream = cameraStream;

      if (localVideoref.current) {
        localVideoref.current.srcObject = cameraStream;
      }

      const cameraTrack =
        cameraStream.getVideoTracks()[0];

      for (let id in connections.current) {
        const sender =
          connections.current[id]
            .getSenders()
            .find(
              (sender) =>
                sender.track &&
                sender.track.kind === "video"
            );

        if (sender && cameraTrack) {
          await sender.replaceTrack(cameraTrack);
        }
      }
    } catch (error) {
      console.log("CAMERA RESTORE ERROR:", error);
    }
  };

  /*
   * SOCKET.IO
   */
  const connectToSocketServer = () => {
    socketRef.current = io.connect(server_url, {
      secure: false,
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => {
      socketIdRef.current = socketRef.current.id;

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
          setVideos((prevVideos) =>
            prevVideos.filter(
              (video) => video.socketId !== id
            )
          );

          delete connections.current[id];
        }
      );

      socketRef.current.on(
        "user-joined",
        (id, clients) => {
          clients.forEach((socketListId) => {
            if (
              connections.current[socketListId]
            ) {
              return;
            }

            const peerConnection =
              new RTCPeerConnection(
                peerConfigConnections
              );

            connections.current[socketListId] =
              peerConnection;

            /*
             * ICE CANDIDATE
             */
            peerConnection.onicecandidate = (
              event
            ) => {
              if (event.candidate) {
                socketRef.current.emit(
                  "signal",
                  socketListId,
                  JSON.stringify({
                    ice: event.candidate,
                  })
                );
              }
            };

            /*
             * REMOTE STREAM
             */
            peerConnection.ontrack = (event) => {
              if (!event.streams[0]) return;

              const remoteStream =
                event.streams[0];

              const existingVideo =
                videoRef.current.find(
                  (video) =>
                    video.socketId === socketListId
                );

              if (existingVideo) {
                setVideos((prevVideos) => {
                  const updatedVideos =
                    prevVideos.map((video) =>
                      video.socketId === socketListId
                        ? {
                            ...video,
                            stream: remoteStream,
                          }
                        : video
                    );

                  videoRef.current =
                    updatedVideos;

                  return updatedVideos;
                });
              } else {
                const newVideo = {
                  socketId: socketListId,
                  stream: remoteStream,
                  autoplay: true,
                  playsinline: true,
                };

                setVideos((prevVideos) => {
                  const updatedVideos = [
                    ...prevVideos,
                    newVideo,
                  ];

                  videoRef.current =
                    updatedVideos;

                  return updatedVideos;
                });
              }
            };

            /*
             * ADD LOCAL TRACKS
             */
            if (
              window.localStream
            ) {
              window.localStream
                .getTracks()
                .forEach((track) => {
                  try {
                    peerConnection.addTrack(
                      track,
                      window.localStream
                    );
                  } catch (e) {}
                });
            } else {
              window.localStream =
                new MediaStream([
                  black(),
                  silence(),
                ]);

              window.localStream
                .getTracks()
                .forEach((track) => {
                  peerConnection.addTrack(
                    track,
                    window.localStream
                  );
                });
            }
          });

          /*
           * CREATE OFFER
           */
          if (
            id === socketIdRef.current
          ) {
            for (let id2 in connections.current) {
              if (
                id2 === socketIdRef.current
              ) {
                continue;
              }

              connections.current[id2]
                .createOffer()
                .then((description) => {
                  return connections.current[
                    id2
                  ].setLocalDescription(
                    description
                  );
                })
                .then(() => {
                  socketRef.current.emit(
                    "signal",
                    id2,
                    JSON.stringify({
                      sdp:
                        connections.current[
                          id2
                        ].localDescription,
                    })
                  );
                })
                .catch((e) =>
                  console.log(
                    "CREATE OFFER ERROR:",
                    e
                  )
                );
            }
          }
        }
      );
    });

    /*
     * WEBRTC SIGNAL
     */
    socketRef.current.on(
      "signal",
      gotMessageFromServer
    );
  };

  /*
   * RECEIVE SIGNAL
   */
  const gotMessageFromServer = (
    fromId,
    message
  ) => {
    try {
      const signal = JSON.parse(message);

      if (fromId === socketIdRef.current) {
        return;
      }

      if (!connections.current[fromId]) {
        return;
      }

      if (signal.sdp) {
        connections.current[fromId]
          .setRemoteDescription(
            new RTCSessionDescription(
              signal.sdp
            )
          )
          .then(() => {
            if (
              signal.sdp.type ===
              "offer"
            ) {
              return connections.current[
                fromId
              ].createAnswer();
            }
          })
          .then((answer) => {
            if (!answer) return;

            return connections.current[
              fromId
            ].setLocalDescription(
              answer
            );
          })
          .then(() => {
            if (
              connections.current[
                fromId
              ]?.localDescription
            ) {
              socketRef.current.emit(
                "signal",
                fromId,
                JSON.stringify({
                  sdp:
                    connections.current[
                      fromId
                    ].localDescription,
                })
              );
            }
          })
          .catch((e) =>
            console.log(
              "SIGNAL ERROR:",
              e
            )
          );
      }

      if (signal.ice) {
        connections.current[fromId]
          .addIceCandidate(
            new RTCIceCandidate(
              signal.ice
            )
          )
          .catch((e) =>
            console.log(
              "ICE ERROR:",
              e
            )
          );
      }
    } catch (error) {
      console.log(
        "SIGNAL PARSE ERROR:",
        error
      );
    }
  };

  /*
   * CAMERA
   */
  const handleVideo = () => {
    setVideo((prev) => !prev);
  };

  /*
   * MICROPHONE
   */
  const handleAudio = () => {
    setAudio((prev) => !prev);
  };

  /*
   * END CALL
   */
  const handleEndCall = () => {
    try {
      if (window.localStream) {
        window.localStream
          .getTracks()
          .forEach((track) => track.stop());
      }
    } catch (e) {}

    try {
      if (window.screenStream) {
        window.screenStream
          .getTracks()
          .forEach((track) => track.stop());
      }
    } catch (e) {}

    try {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    } catch (e) {}

    window.location.href = "/";
  };

  /*
   * CHAT OPEN
   */
  const openChat = () => {
    setModal(true);
    setNewMessages(0);
  };

  /*
   * CHAT CLOSE
   */
  const closeChat = () => {
    setModal(false);
  };

  /*
   * ADD CHAT MESSAGE
   */
  const addMessage = (
    data,
    sender,
    socketIdSender
  ) => {
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        sender: sender || "Participant",
        data: data,
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

  /*
   * SEND CHAT MESSAGE
   */
  const sendMessage = () => {
    const text = message.trim();

    if (!text) return;

    if (!socketRef.current) {
      console.log("Socket not connected");
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
   * COPY LINK
   */
  const copyMeetingLink = async () => {
    try {
      await navigator.clipboard.writeText(
        window.location.href
      );

      alert("Meeting link copied!");
    } catch (error) {
      console.log(
        "COPY ERROR:",
        error
      );
    }
  };

  /*
   * SHARE LINK
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
   * CONNECT
   */
  const connect = () => {
    if (!username.trim()) {
      alert("Please enter your name");
      return;
    }

    setAskForUsername(false);
    getMedia();
  };

  /*
   * SILENCE TRACK
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
   * BLACK VIDEO TRACK
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
         * =====================
         * LOBBY
         * =====================
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
                ref={localVideoref}
                autoPlay
                muted
                playsInline
                style={{
                  width: "100%",
                  maxHeight: "350px",
                  borderRadius: "12px",
                  background: "#111",
                  objectFit: "cover",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "10px",
                flexWrap: "wrap",
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
                    e.key === "Enter"
                  ) {
                    connect();
                  }
                }}
              />

              <Button
                variant="contained"
                onClick={connect}
                style={{
                  minHeight: "56px",
                }}
              >
                Join Meeting
              </Button>
            </div>

            <div
              style={{
                marginTop: "20px",
                display: "flex",
                justifyContent: "center",
                gap: "10px",
                flexWrap: "wrap",
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
                    marginRight: "5px",
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
                    marginRight: "5px",
                  }}
                />
                Share
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /*
         * =====================
         * VIDEO MEETING
         * =====================
         */
        <div
          className={
            styles.meetVideoContainer
          }
        >
          {/* TOP BAR */}
          <div
            style={{
              position: "absolute",
              top: "10px",
              left: "15px",
              right: "15px",
              zIndex: 3000,
              display: "flex",
              alignItems: "center",
              justifyContent:
                "space-between",
              color: "white",
            }}
          >
            <div>
              <strong>Velnoxa</strong>

              <div
                style={{
                  fontSize: "12px",
                  opacity: 0.8,
                }}
              >
                Meeting: {meetingId}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "5px",
              }}
            >
              <IconButton
                onClick={
                  copyMeetingLink
                }
                style={{
                  color: "white",
                }}
                title="Copy Meeting Link"
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
                title="Share Meeting"
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
                  {messages.length > 0 ? (
                    messages.map(
                      (
                        item,
                        index
                      ) => (
                        <div
                          key={index}
                          className={
                            styles.chatMessage
                          }
                        >
                          <p
                            className={
                              styles.chatSender
                            }
                          >
                            {item.sender}
                          </p>

                          <p
                            className={
                              styles.chatText
                            }
                          >
                            {item.data}
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
                    value={message}
                    onChange={(e) =>
                      setMessage(
                        e.target.value
                      )
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter"
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
            {/* VIDEO */}
            <IconButton
              onClick={
                handleVideo
              }
              style={{
                color: "white",
              }}
              title={
                video
                  ? "Turn Camera Off"
                  : "Turn Camera On"
              }
            >
              {video ? (
                <VideocamIcon />
              ) : (
                <VideocamOffIcon />
              )}
            </IconButton>

            {/* END CALL */}
            <IconButton
              onClick={
                handleEndCall
              }
              style={{
                color: "red",
              }}
              title="End Call"
            >
              <CallEndIcon />
            </IconButton>

            {/* AUDIO */}
            <IconButton
              onClick={
                handleAudio
              }
              style={{
                color: "white",
              }}
              title={
                audio
                  ? "Mute"
                  : "Unmute"
              }
            >
              {audio ? (
                <MicIcon />
              ) : (
                <MicOffIcon />
              )}
            </IconButton>

            {/* SCREEN SHARE */}
            {screenAvailable && (
              <IconButton
                onClick={() =>
                  setScreen(
                    (prev) => !prev
                  )
                }
                style={{
                  color: "white",
                }}
                title="Screen Share"
              >
                {screen ? (
                  <ScreenShareIcon />
                ) : (
                  <StopScreenShareIcon />
                )}
              </IconButton>
            )}

            {/* COPY */}
            <IconButton
              onClick={
                copyMeetingLink
              }
              style={{
                color: "white",
              }}
              title="Copy Meeting Link"
            >
              <ContentCopyIcon />
            </IconButton>

            {/* SHARE */}
            <IconButton
              onClick={
                shareMeetingLink
              }
              style={{
                color: "white",
              }}
              title="Share Meeting"
            >
              <ShareIcon />
            </IconButton>

            {/* CHAT */}
            <Badge
              badgeContent={
                newMessages > 0
                  ? newMessages
                  : null
              }
              max={999}
              color="error"
            >
              <IconButton
                onClick={() => {
                  if (showModal) {
                    closeChat();
                  } else {
                    openChat();
                  }
                }}
                style={{
                  color: "white",
                }}
                title="Open Chat"
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
              display: "grid",
              gridTemplateColumns:
                videos.length <= 1
                  ? "1fr"
                  : videos.length <= 4
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
                    width: "100%",
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
                      bottom: "10px",
                      left: "10px",
                      background:
                        "rgba(0,0,0,0.6)",
                      color: "white",
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