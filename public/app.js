const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000
});

const $ = (id) => document.getElementById(id);

const joinScreen = $("joinScreen");
const app = $("app");

const nameInput = $("nameInput");
const roomInput = $("roomInput");
const randomRoomButton = $("randomRoomButton");
const joinButton = $("joinButton");

const roomLabel = $("roomLabel");
const peopleCount = $("peopleCount");
const peopleList = $("peopleList");

const videoGrid = $("videoGrid");
const emptyStage = $("emptyStage");

const micButton = $("micButton");
const cameraButton = $("cameraButton");
const screenButton = $("screenButton");
const leaveButton = $("leaveButton");

const copyButton = $("copyButton");
const sidebarButton = $("sidebarButton");
const sidePanel = $("sidePanel");

const messageForm = $("messageForm");
const messageInput = $("messageInput");
const messages = $("messages");

const fileInput = $("fileInput");
const filesList = $("filesList");

const watchButton = $("watchButton");
const watchDialog = $("watchDialog");
const mediaUrlInput = $("mediaUrlInput");
const loadMediaButton = $("loadMediaButton");
const watchStage = $("watchStage");
const youtubeContainer = $("youtubeContainer");
const closeWatchButton = $("closeWatchButton");

const reactionButton = $("reactionButton");
const reactionMenu = $("reactionMenu");
const reactionLayer = $("reactionLayer");

const connectionText = $("connectionText");
const connectionDot = $("connectionDot");

const toastElement = $("toast");

let roomId = "";
let displayName = "";

let localStream = null;
let screenStream = null;

let micEnabled = true;
let cameraEnabled = true;
let sharingScreen = false;

const peers = new Map();
const peerNames = new Map();

const receivedFileChunks = new Map();

const rtcConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302"
      ]
    }

    /*
      Production TURN example:

      {
        urls: "turn:YOUR_TURN_SERVER:3478",
        username: "TEMP_USERNAME",
        credential: "TEMP_PASSWORD"
      }

      Do NOT put permanent TURN secrets here.
    */
  ]
};


/* -----------------------------------------
   INITIAL URL
------------------------------------------ */

const params = new URLSearchParams(location.search);

if (params.get("room")) {
  roomInput.value = params.get("room");
}

const savedName = localStorage.getItem("nexora-name");

if (savedName) {
  nameInput.value = savedName;
}


/* -----------------------------------------
   HELPERS
------------------------------------------ */

function randomRoom() {
  return Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase();
}

function toast(text) {
  toastElement.textContent = text;
  toastElement.classList.add("show");

  clearTimeout(toastElement.timer);

  toastElement.timer = setTimeout(() => {
    toastElement.classList.remove("show");
  }, 2200);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];

  const index = Math.floor(
    Math.log(bytes) / Math.log(1024)
  );

  return (
    (bytes / Math.pow(1024, index)).toFixed(1) +
    " " +
    units[index]
  );
}


/* -----------------------------------------
   JOIN
------------------------------------------ */

randomRoomButton.addEventListener("click", () => {
  roomInput.value = randomRoom();
});

joinButton.addEventListener("click", joinRoom);

async function joinRoom() {

  displayName =
    nameInput.value.trim() ||
    "Guest";

  roomId =
    roomInput.value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "");

  if (!roomId) {
    roomId = randomRoom().toLowerCase();
  }

  joinButton.disabled = true;
  joinButton.textContent = "Connecting...";

  try {

    localStream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },

        video: {
          width: {
            ideal: 1280
          },

          height: {
            ideal: 720
          },

          frameRate: {
            ideal: 30,
            max: 30
          }
        }
      });

  } catch (error) {

    console.warn(error);

    try {

      localStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });

      cameraEnabled = false;

    } catch (secondError) {

      toast("Camera/microphone permission is required.");

      joinButton.disabled = false;
      joinButton.textContent = "Enter room";

      return;
    }
  }

  localStorage.setItem(
    "nexora-name",
    displayName
  );

  history.replaceState(
    {},
    "",
    `/?room=${encodeURIComponent(roomId)}`
  );

  socket.emit(
    "join-room",
    {
      roomId,
      name: displayName
    },

    async (response) => {

      if (!response?.ok) {

        toast(
          response?.error ||
          "Unable to join room."
        );

        return;
      }

      joinScreen.classList.add("hidden");
      app.classList.remove("hidden");

      roomLabel.textContent =
        `Room • ${roomId}`;

      addVideoCard(
        socket.id,
        displayName + " (You)",
        localStream,
        true
      );

      updateUsers(response.users);

      /*
        Existing users create offers toward us.
        We wait for their offers.
      */

      if (response.media?.url) {
        loadSharedMedia(response.media.url);
      }

      toast("Welcome to NEXORA");
    }
  );
}


/* -----------------------------------------
   PEER CONNECTION
------------------------------------------ */

function createPeer(peerId, peerName) {

  if (peers.has(peerId)) {
    return peers.get(peerId);
  }

  peerNames.set(
    peerId,
    peerName || "Guest"
  );

  const pc =
    new RTCPeerConnection(
      rtcConfiguration
    );

  const peer = {
    pc,
    channel: null
  };

  peers.set(peerId, peer);

  if (localStream) {

    for (const track of localStream.getTracks()) {

      pc.addTrack(
        track,
        localStream
      );
    }
  }

  pc.onicecandidate = (event) => {

    if (!event.candidate) return;

    socket.emit("signal", {
      target: peerId,

      data: {
        type: "candidate",
        candidate: event.candidate
      }
    });
  };

  pc.ontrack = (event) => {

    const stream =
      event.streams[0];

    addVideoCard(
      peerId,
      peerNames.get(peerId) || "Guest",
      stream
    );
  };

  pc.onconnectionstatechange = () => {

    const state =
      pc.connectionState;

    if (
      state === "failed" ||
      state === "disconnected"
    ) {

      updateConnectionStatus(
        "Reconnecting..."
      );

    }

    if (state === "failed") {

      try {
        pc.restartIce();
      } catch {}

    }

    if (state === "connected") {

      updateConnectionStatus(
        "Connected"
      );

    }

    if (state === "closed") {
      removePeer(peerId);
    }
  };

  pc.ondatachannel = (event) => {

    setupDataChannel(
      peerId,
      event.channel
    );

  };

  return peer;
}


async function createOffer(peerId) {

  const peer =
    createPeer(
      peerId,
      peerNames.get(peerId)
    );

  if (!peer.channel) {

    const channel =
      peer.pc.createDataChannel(
        "nexora-data",
        {
          ordered: true
        }
      );

    setupDataChannel(
      peerId,
      channel
    );
  }

  const offer =
    await peer.pc.createOffer();

  await peer.pc.setLocalDescription(
    offer
  );

  socket.emit("signal", {

    target: peerId,

    data: {
      type: "offer",
      sdp: offer
    }

  });
}


/* -----------------------------------------
   SIGNALING
------------------------------------------ */

socket.on(
  "user-joined",
  async ({ id, name }) => {

    peerNames.set(id, name);

    /*
      Existing participant creates the offer
      for the newcomer.
    */

    try {
      await createOffer(id);
    } catch (error) {
      console.error(error);
    }

  }
);


socket.on(
  "signal",
  async ({ from, name, data }) => {

    try {

      peerNames.set(
        from,
        name || "Guest"
      );

      const peer =
        createPeer(
          from,
          name
        );

      if (data.type === "offer") {

        await peer.pc.setRemoteDescription(
          data.sdp
        );

        const answer =
          await peer.pc.createAnswer();

        await peer.pc.setLocalDescription(
          answer
        );

        socket.emit("signal", {

          target: from,

          data: {
            type: "answer",
            sdp: answer
          }

        });

      }

      else if (data.type === "answer") {

        await peer.pc.setRemoteDescription(
          data.sdp
        );

      }

      else if (data.type === "candidate") {

        if (data.candidate) {

          await peer.pc.addIceCandidate(
            data.candidate
          );

        }

      }

    } catch (error) {

      console.error(
        "Signaling error:",
        error
      );

    }
  }
);


socket.on(
  "user-left",
  ({ id }) => {
    removePeer(id);
  }
);


socket.on(
  "room-users",
  (users) => {
    updateUsers(users);
  }
);


/* -----------------------------------------
   VIDEO CARDS
------------------------------------------ */

function addVideoCard(
  id,
  name,
  stream,
  muted = false
) {

  let card =
    document.querySelector(
      `[data-video-id="${id}"]`
    );

  if (!card) {

    card =
      document.createElement("div");

    card.className =
      "video-card";

    card.dataset.videoId =
      id;

    const video =
      document.createElement("video");

    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;

    const label =
      document.createElement("div");

    label.className =
      "video-name";

    label.textContent =
      name;

    card.appendChild(video);
    card.appendChild(label);

    videoGrid.appendChild(card);
  }

  const video =
    card.querySelector("video");

  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }

  emptyStage.classList.add(
    "hidden"
  );
}


function removePeer(peerId) {

  const peer =
    peers.get(peerId);

  if (peer) {

    try {
      peer.channel?.close();
    } catch {}

    try {
      peer.pc.close();
    } catch {}

  }

  peers.delete(peerId);
  peerNames.delete(peerId);

  document
    .querySelector(
      `[data-video-id="${peerId}"]`
    )
    ?.remove();
}


/* -----------------------------------------
   PEOPLE
------------------------------------------ */

function updateUsers(users) {

  peopleCount.textContent =
    users.length;

  peopleList.innerHTML = "";

  users.forEach((user) => {

    const item =
      document.createElement("div");

    item.className =
      "person";

    const initial =
      (user.name || "?")
        .charAt(0)
        .toUpperCase();

    item.innerHTML = `
      <div class="avatar">
        ${escapeHtml(initial)}
      </div>

      <div class="person-name">
        ${escapeHtml(user.name)}
        ${user.id === socket.id ? " (You)" : ""}
      </div>

      <div class="online-dot"></div>
    `;

    peopleList.appendChild(
      item
    );

  });
}


/* -----------------------------------------
   MICROPHONE
------------------------------------------ */

micButton.addEventListener(
  "click",
  () => {

    if (!localStream) return;

    micEnabled =
      !micEnabled;

    localStream
      .getAudioTracks()
      .forEach((track) => {
        track.enabled =
          micEnabled;
      });

    micButton.classList.toggle(
      "off",
      !micEnabled
    );

    micButton.textContent =
      micEnabled ? "🎙" : "🔇";
  }
);


/* -----------------------------------------
   CAMERA
------------------------------------------ */

cameraButton.addEventListener(
  "click",
  () => {

    if (!localStream) return;

    cameraEnabled =
      !cameraEnabled;

    localStream
      .getVideoTracks()
      .forEach((track) => {
        track.enabled =
          cameraEnabled;
      });

    cameraButton.classList.toggle(
      "off",
      !cameraEnabled
    );

    cameraButton.textContent =
      cameraEnabled ? "📹" : "🚫";
  }
);


/* -----------------------------------------
   SCREEN SHARE
------------------------------------------ */

screenButton.addEventListener(
  "click",
  async () => {

    if (sharingScreen) {

      stopScreenShare();
      return;
    }

    try {

      screenStream =
        await navigator.mediaDevices
          .getDisplayMedia({
            video: {
              frameRate: {
                ideal: 30
              }
            },

            audio: true
          });

      const screenTrack =
        screenStream
          .getVideoTracks()[0];

      for (const peer of peers.values()) {

        const sender =
          peer.pc
            .getSenders()
            .find(
              (sender) =>
                sender.track?.kind ===
                "video"
            );

        if (sender) {
          await sender.replaceTrack(
            screenTrack
          );
        }
      }

      const localVideo =
        document.querySelector(
          `[data-video-id="${socket.id}"] video`
        );

      if (localVideo) {
        localVideo.srcObject =
          screenStream;
      }

      sharingScreen = true;

      screenButton.classList.add(
        "active"
      );

      screenButton.textContent =
        "■";

      screenTrack.onended =
        stopScreenShare;

      toast(
        "Screen sharing started"
      );

    } catch (error) {

      console.log(error);

    }
  }
);


async function stopScreenShare() {

  if (!sharingScreen) return;

  const cameraTrack =
    localStream
      ?.getVideoTracks()[0];

  if (cameraTrack) {

    for (const peer of peers.values()) {

      const sender =
        peer.pc
          .getSenders()
          .find(
            (sender) =>
              sender.track?.kind ===
              "video"
          );

      if (sender) {
        await sender.replaceTrack(
          cameraTrack
        );
      }
    }
  }

  screenStream
    ?.getTracks()
    .forEach(
      (track) => track.stop()
    );

  screenStream = null;
  sharingScreen = false;

  const localVideo =
    document.querySelector(
      `[data-video-id="${socket.id}"] video`
    );

  if (localVideo) {
    localVideo.srcObject =
      localStream;
  }

  screenButton.textContent =
    "▣";

  toast(
    "Screen sharing stopped"
  );
}


/* -----------------------------------------
   CHAT
------------------------------------------ */

messageForm.addEventListener(
  "submit",
  (event) => {

    event.preventDefault();

    const text =
      messageInput.value.trim();

    if (!text) return;

    socket.emit(
      "chat-message",
      {
        text
      }
    );

    messageInput.value = "";
  }
);


socket.on(
  "chat-message",
  (message) => {

    const item =
      document.createElement("div");

    item.className =
      "message";

    if (
      message.senderId ===
      socket.id
    ) {
      item.classList.add("mine");
    }

    const time =
      new Date(
        message.timestamp
      ).toLocaleTimeString(
        [],
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      );

    item.innerHTML = `
      <div class="message-head">
        <span>${escapeHtml(message.name)}</span>
        <span>${time}</span>
      </div>

      <div class="message-body">
        ${escapeHtml(message.text)}
      </div>
    `;

    messages.appendChild(item);

    messages.scrollTop =
      messages.scrollHeight;
  }
);


/* -----------------------------------------
   FILE DATA CHANNEL
------------------------------------------ */

function setupDataChannel(
  peerId,
  channel
) {

  const peer =
    peers.get(peerId);

  if (!peer) return;

  peer.channel = channel;

  channel.binaryType =
    "arraybuffer";

  channel.onopen = () => {
    console.log(
      "Data channel open:",
      peerId
    );
  };

  channel.onmessage = (event) => {

    if (
      typeof event.data ===
      "string"
    ) {

      const message =
        JSON.parse(event.data);

      if (
        message.type ===
        "file-meta"
      ) {

        receivedFileChunks.set(
          message.id,
          {
            id: message.id,
            name: message.name,
            size: message.size,
            type:
              message.mime ||
              "application/octet-stream",
            chunks: [],
            received: 0
          }
        );

      }

      else if (
        message.type ===
        "file-end"
      ) {

        finishReceivedFile(
          message.id
        );

      }

      return;
    }

    const active =
      [...receivedFileChunks.values()]
        .find(
          (file) =>
            file.received <
            file.size
        );

    if (!active) return;

    active.chunks.push(
      event.data
    );

    active.received +=
      event.data.byteLength;
  };
}


fileInput.addEventListener(
  "change",
  async () => {

    const file =
      fileInput.files[0];

    if (!file) return;

    /*
      Keep browser P2P transfers small
      in this starter.

      Large files should use object storage
      with resumable upload.
    */

    const maxSize =
      25 * 1024 * 1024;

    if (file.size > maxSize) {

      toast(
        "Starter version supports files up to 25 MB."
      );

      fileInput.value = "";
      return;
    }

    const id =
      crypto.randomUUID();

    addFileItem(
      file.name,
      file.size,
      "Sending..."
    );

    const buffer =
      await file.arrayBuffer();

    const chunkSize =
      16 * 1024;

    for (const peer of peers.values()) {

      const channel =
        peer.channel;

      if (
        !channel ||
        channel.readyState !==
        "open"
      ) {
        continue;
      }

      channel.send(
        JSON.stringify({
          type: "file-meta",
          id,
          name: file.name,
          size: file.size,
          mime: file.type
        })
      );

      for (
        let offset = 0;
        offset < buffer.byteLength;
        offset += chunkSize
      ) {

        while (
          channel.bufferedAmount >
          1024 * 1024
        ) {

          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                20
              )
          );
        }

        channel.send(
          buffer.slice(
            offset,
            offset + chunkSize
          )
        );
      }

      channel.send(
        JSON.stringify({
          type: "file-end",
          id
        })
      );
    }

    toast("File sent");

    fileInput.value = "";
  }
);


function finishReceivedFile(id) {

  const file =
    receivedFileChunks.get(id);

  if (!file) return;

  const blob =
    new Blob(
      file.chunks,
      {
        type: file.type
      }
    );

  const url =
    URL.createObjectURL(blob);

  addFileItem(
    file.name,
    file.size,
    "Received",
    url
  );

  receivedFileChunks.delete(id);

  toast(
    `Received ${file.name}`
  );
}


function addFileItem(
  name,
  size,
  status,
  url = null
) {

  const item =
    document.createElement("div");

  item.className =
    "file-item";

  item.innerHTML = `
    <div class="file-name">
      ${escapeHtml(name)}
    </div>

    <div class="file-meta">
      ${formatBytes(size)}
      •
      ${escapeHtml(status)}
    </div>
  `;

  if (url) {

    const link =
      document.createElement("a");

    link.href = url;
    link.download = name;

    link.textContent =
      "Save file";

    link.style.display =
      "inline-block";

    link.style.marginTop =
      "8px";

    link.style.color =
      "#aa9eff";

    item.appendChild(link);
  }

  filesList.prepend(item);
}


/* -----------------------------------------
   WATCH TOGETHER
------------------------------------------ */

watchButton.addEventListener(
  "click",
  () => {

    watchDialog.showModal();

  }
);


loadMediaButton.addEventListener(
  "click",
  (event) => {

    event.preventDefault();

    const url =
      mediaUrlInput.value.trim();

    const videoId =
      extractYouTubeId(url);

    if (!videoId) {

      toast(
        "Enter a valid YouTube URL."
      );

      return;
    }

    socket.emit(
      "media-load",
      {
        url
      }
    );

    loadSharedMedia(url);

    watchDialog.close();
  }
);


socket.on(
  "media-load",
  ({ url }) => {

    loadSharedMedia(url);

  }
);


function extractYouTubeId(url) {

  try {

    const parsed =
      new URL(url);

    if (
      parsed.hostname.includes(
        "youtu.be"
      )
    ) {

      return parsed.pathname
        .slice(1)
        .split("/")[0];
    }

    if (
      parsed.hostname.includes(
        "youtube.com"
      )
    ) {

      if (
        parsed.pathname.startsWith(
          "/shorts/"
        )
      ) {

        return parsed.pathname
          .split("/")[2];
      }

      return parsed.searchParams.get(
        "v"
      );
    }

  } catch {}

  return null;
}


function loadSharedMedia(url) {

  const videoId =
    extractYouTubeId(url);

  if (!videoId) return;

  youtubeContainer.innerHTML =
    "";

  const iframe =
    document.createElement("iframe");

  iframe.src =
    `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;

  iframe.allow =
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

  iframe.allowFullscreen = true;

  youtubeContainer.appendChild(
    iframe
  );

  watchStage.classList.remove(
    "hidden"
  );

  toast(
    "Watch Together started"
  );
}


closeWatchButton.addEventListener(
  "click",
  () => {

    watchStage.classList.add(
      "hidden"
    );

    youtubeContainer.innerHTML =
      "";

  }
);


/* -----------------------------------------
   REACTIONS
------------------------------------------ */

reactionButton.addEventListener(
  "click",
  () => {

    reactionMenu.classList.toggle(
      "hidden"
    );

  }
);


reactionMenu
  .querySelectorAll("button")
  .forEach((button) => {

    button.addEventListener(
      "click",
      () => {

        socket.emit(
          "reaction",
          {
            emoji:
              button.textContent
          }
        );

        reactionMenu.classList.add(
          "hidden"
        );
      }
    );

  });


socket.on(
  "reaction",
  ({ emoji }) => {

    const element =
      document.createElement("div");

    element.className =
      "floating-reaction";

    element.textContent =
      emoji;

    element.style.left =
      `${35 + Math.random() * 30}%`;

    reactionLayer.appendChild(
      element
    );

    setTimeout(
      () => element.remove(),
      2600
    );

  }
);


/* -----------------------------------------
   TABS
------------------------------------------ */

document
  .querySelectorAll(".tab")
  .forEach((tab) => {

    tab.addEventListener(
      "click",
      () => {

        document
          .querySelectorAll(".tab")
          .forEach(
            (item) =>
              item.classList.remove(
                "active"
              )
          );

        document
          .querySelectorAll(
            ".tab-content"
          )
          .forEach(
            (item) =>
              item.classList.remove(
                "active"
              )
          );

        tab.classList.add(
          "active"
        );

        $(
          tab.dataset.tab + "Tab"
        ).classList.add(
          "active"
        );
      }
    );

  });


sidebarButton.addEventListener(
  "click",
  () => {

    sidePanel.classList.toggle(
      "open"
    );

  }
);


/* -----------------------------------------
   INVITE
------------------------------------------ */

copyButton.addEventListener(
  "click",
  async () => {

    const url =
      `${location.origin}/?room=${encodeURIComponent(roomId)}`;

    try {

      await navigator.clipboard.writeText(
        url
      );

      toast(
        "Invite link copied"
      );

    } catch {

      prompt(
        "Copy this room link:",
        url
      );

    }
  }
);


/* -----------------------------------------
   CONNECTION
------------------------------------------ */

function updateConnectionStatus(
  text
) {

  connectionText.textContent =
    text;

  if (
    text === "Connected"
  ) {

    connectionDot.style.background =
      "#42e6a4";

  } else {

    connectionDot.style.background =
      "#ffb84d";

  }
}


socket.on("connect", () => {

  updateConnectionStatus(
    "Connected"
  );

});


socket.on("disconnect", () => {

  updateConnectionStatus(
    "Reconnecting..."
  );

});


socket.io.on(
  "reconnect",
  () => {

    updateConnectionStatus(
      "Connected"
    );

    if (
      roomId &&
      displayName
    ) {

      /*
        Re-register room after Socket.IO
        reconnect.

        Existing WebRTC connections may
        renegotiate as participants see
        the new socket ID.
      */

      socket.emit(
        "join-room",
        {
          roomId,
          name: displayName
        }
      );

    }
  }
);


/* -----------------------------------------
   LEAVE
------------------------------------------ */

leaveButton.addEventListener(
  "click",
  () => {

    localStream
      ?.getTracks()
      .forEach(
        (track) =>
          track.stop()
      );

    screenStream
      ?.getTracks()
      .forEach(
        (track) =>
          track.stop()
      );

    for (
      const peerId of peers.keys()
    ) {

      removePeer(peerId);

    }

    socket.disconnect();

    location.href =
      location.origin;

  }
);


/* -----------------------------------------
   SERVICE WORKER
------------------------------------------ */

if (
  "serviceWorker" in navigator
) {

  window.addEventListener(
    "load",
    () => {

      navigator.serviceWorker
        .register("/sw.js")
        .catch(console.error);

    }
  );

}