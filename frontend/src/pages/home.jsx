import React, { useContext, useState } from "react";
import withAuth from "../utils/withAuth";
import { useNavigate } from "react-router-dom";
import "../App.css";

import { Button, IconButton, TextField } from "@mui/material";
import RestoreIcon from "@mui/icons-material/Restore";
import { AuthContext } from "../contexts/AuthContext";

function HomeComponent() {
  const navigate = useNavigate();

  const [meetingCode, setMeetingCode] = useState("");

  const { addToUserHistory } = useContext(AuthContext);

  // Join an existing meeting
  const handleJoinVideoCall = async () => {
    const code = meetingCode.trim();

    if (!code) {
      alert("Please enter a meeting code");
      return;
    }

    try {
      await addToUserHistory(code);
      navigate(`/meet/${code}`);
    } catch (error) {
      console.log("Error joining meeting:", error);
    }
  };

  // Create a new meeting
  const handleCreateMeeting = async () => {
    const newMeetingCode = Math.random()
      .toString(36)
      .substring(2, 10);

    try {
      await addToUserHistory(newMeetingCode);
      navigate(`/meet/${newMeetingCode}`);
    } catch (error) {
      console.log("Error creating meeting:", error);
    }
  };

  // Logout user
  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/auth");
  };

  return (
    <>
      <div className="navBar">
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2>Velnoxa</h2>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <IconButton
            onClick={() => navigate("/history")}
            title="Meeting History"
          >
            <RestoreIcon />
          </IconButton>

          <p>History</p>

          <Button onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>

      <div className="meetContainer">
        <div className="leftPanel">
          <div>
            <h2>
              Providing Quality Video Call Just Like Quality Education
            </h2>

            <div
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              <TextField
                value={meetingCode}
                onChange={(e) => setMeetingCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleJoinVideoCall();
                  }
                }}
                id="outlined-basic"
                label="Meeting Code"
                variant="outlined"
              />

              <Button
                onClick={handleJoinVideoCall}
                variant="contained"
              >
                Join
              </Button>

              <Button
                onClick={handleCreateMeeting}
                variant="outlined"
              >
                Create Meeting
              </Button>
            </div>
          </div>
        </div>

        <div className="rightPanel">
          <img src="/logo3.png" alt="Velnoxa Video Call" />
        </div>
      </div>
    </>
  );
}

export default withAuth(HomeComponent);