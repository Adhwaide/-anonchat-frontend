const socket = new WebSocket("wss://ballistic-autumn-cockatoo.glitch.me");

// When WebSocket connection is opened
socket.onopen = () => {
    console.log("Connected to WebSocket server");
    displayStatus("You are now connected!");
};

// Handling messages received from the server
socket.onmessage = async (event) => {
    let message;

    if (event.data instanceof Blob) {
        message = await event.data.text(); // Convert Blob to text
    } else {
        message = event.data.toString(); // Ensure it's treated as a string
    }

    processMessage(message);
};

// Handling WebSocket closure
socket.onclose = () => {
    displayStatus("Disconnected from server.");
};

// Function to process the received message
function processMessage(message) {
    if (message === "You are now connected!") {
        isConnected = true;
        displayStatus(message);
    } else if (message === "Waiting for a partner to connect...") {
        displayStatus(message);
    } else if (message === "Your partner has disconnected.") {
        isConnected = false;
        displayStatus(message);
    } else {
        displayMessage("Stranger", message);
    }
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
        displayMessage("You", input.value);
        input.value = "";
    }
}

// Function to display messages in the chat
function displayMessage(sender, message) {
    const chatBox = document.getElementById("chatBox");
    const messageElement = document.createElement("p");
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
