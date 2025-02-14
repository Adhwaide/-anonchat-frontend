const socket = new WebSocket("wss://ballistic-autumn-cockatoo.glitch.me");

socket.onopen = () => {
    console.log("Connected to WebSocket server");
    displayStatus("You are now connected!");
};

socket.onmessage = async (event) => {
    let message = event.data instanceof Blob ? await event.data.text() : event.data;

    if (message === "typing...") {
        document.getElementById("typingIndicator").style.display = "block";
        return; // Don't show "typing..." as a message
    } else {
        document.getElementById("typingIndicator").style.display = "none"; // Hide when message arrives
    }

    if (message === "You are now connected!") {
        isConnected = true;
        displayStatus("You are now connected!");
    } else if (message === "Your partner has disconnected.") {
        isConnected = false;
        displayStatus("Your partner has disconnected.");
    } else {
        displayMessage("Stranger", message, "received");
    }
};

socket.onclose = () => {
    displayStatus("Disconnected from server.");
};

// Send "typing..." status when user starts typing
document.getElementById("messageInput").addEventListener("input", () => {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send("typing...");
    }
});

// Disconnect function
function disconnect() {
    socket.close(); // Close WebSocket connection
    displayStatus("You have disconnected.");
}

// Sending messages
document.getElementById("sendButton").addEventListener("click", sendMessage);
document.getElementById("messageInput").addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
        sendMessage();
    }
});

function sendMessage() {
    const input = document.getElementById("messageInput");
    if (input.value.trim() !== "") {
        socket.send(input.value);
        displayMessage("You", input.value, "sent");
        input.value = "";
    }
}

// Function to display messages in the chat
function displayMessage(sender, message, type) {
    const chatBox = document.getElementById("chatBox");
    const messageElement = document.createElement("p");
    messageElement.classList.add("message", type);
    messageElement.textContent = `${sender}: ${message}`;
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Function to display status messages
function displayStatus(status) {
    const chatBox = document.getElementById("chatBox");
    const statusElement = document.createElement("p");
    statusElement.style.fontStyle = "italic";
    statusElement.textContent = status;
    chatBox.appendChild(statusElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}
