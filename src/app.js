// src/App.js

import React, { useState, useEffect, useRef } from 'react';

// Function to convert Float32Array to PCM16 ArrayBuffer
function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
}

// Function to encode PCM16 ArrayBuffer to Base64
function base64EncodeAudio(arrayBuffer) {
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000; // 32KB chunk size
    for (let i = 0; i < bytes.length; i += chunkSize) {
        let chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

// Function to decode Base64 audio to ArrayBuffer
function base64DecodeAudio(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function App() {
    const [connected, setConnected] = useState(false);
    const [messages, setMessages] = useState([]);
    const [recording, setRecording] = useState(false);
    const [streaming, setStreaming] = useState(false);
    const wsRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const audioContextRef = useRef(null);
    const sourceRef = useRef(null);
    const [audioOutput, setAudioOutput] = useState(null);

    // Unique user ID (In production, use authentication to get unique IDs)
    const userId = 'user1';

    /**
     * Fetches the Web PubSub client access token from the backend
     */
    const getToken = async () => {
        try {
            const response = await fetch(`/api/token?userId=${userId}`);
            const data = await response.json();
            return data.url;
        } catch (error) {
            console.error('Error fetching token:', error);
        }
    };

    /**
     * Establishes WebSocket connection to Azure Web PubSub
     */
    const connectWebSocket = async () => {
        const tokenUrl = await getToken();
        if (!tokenUrl) {
            alert('Failed to obtain WebSocket URL.');
            return;
        }

        const ws = new WebSocket(tokenUrl);

        ws.onopen = () => {
            console.log('Connected to Web PubSub');
            setConnected(true);
            setStreaming(true);
            startRecording();
        };

        ws.onmessage = (event) => {
            const data = event.data;
            try {
                const message = JSON.parse(data);
                if (message.type === 'response.create' || message.type === 'conversation.item.create') {
                    // Handle AI response
                    if (message.content && message.content.audio) {
                        const audioBase64 = message.content.audio;
                        const audioBuffer = base64DecodeAudio(audioBase64);
                        playAudio(audioBuffer);
                    }
                    if (message.content && message.content.text) {
                        setMessages((prev) => [...prev, { sender: 'AI', text: message.content.text }]);
                    }
                }
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        ws.onclose = () => {
            console.log('Disconnected from Web PubSub');
            setConnected(false);
            setStreaming(false);
            stopRecording();
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        wsRef.current = ws;
    };

    /**
     * Closes the WebSocket connection
     */
    const disconnectWebSocket = () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
            setConnected(false);
            setStreaming(false);
            stopRecording();
        }
    };

    /**
     * Starts recording audio from the user's microphone
     */
    const startRecording = async () => {
        if (recording) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });

            mediaRecorderRef.current.ondataavailable = handleDataAvailable;
            mediaRecorderRef.current.onstop = handleStop;

            mediaRecorderRef.current.start(100); // Collect 100ms chunks

            setRecording(true);
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Could not access microphone.');
        }
    };

    /**
     * Stops recording audio
     */
    const stopRecording = () => {
        if (!recording) return;

        mediaRecorderRef.current.stop();
        sourceRef.current.disconnect();
        audioContextRef.current.close();

        setRecording(false);
    };

    /**
     * Handles available audio data chunks
     */
    const handleDataAvailable = (event) => {
        if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            processAudioChunks();
        }
    };

    /**
     * Processes and sends audio chunks to the backend
     */
    const processAudioChunks = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0); // Mono

        const pcm16Buffer = floatTo16BitPCM(channelData);
        const base64Audio = base64EncodeAudio(pcm16Buffer);

        // Send the audio chunk to the backend via WebSocket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const event = {
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [{
                        type: "input_audio",
                        audio: base64Audio
                    }]
                }
            };
            wsRef.current.send(JSON.stringify(event));
        }
    };

    /**
     * Handles MediaRecorder stop event
     */
    const handleStop = () => {
        console.log('Recording stopped.');
    };

    /**
     * Plays received audio from the AI
     */
    const playAudio = (arrayBuffer) => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.decodeAudioData(arrayBuffer, (buffer) => {
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
        }, (error) => {
            console.error('Error decoding audio data:', error);
        });
    };

    /**
     * Starts the WebSocket connection when the component mounts
     */
    useEffect(() => {
        // Cleanup on component unmount
        return () => {
            disconnectWebSocket();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div style={styles.container}>
            <h1>Azure Static Web App Chat with Audio</h1>
            <div style={styles.buttonContainer}>
                <button onClick={connectWebSocket} disabled={connected} style={styles.button}>
                    Start Conversation
                </button>
                <button onClick={disconnectWebSocket} disabled={!connected} style={styles.button}>
                    End Conversation
                </button>
            </div>
            <div style={styles.chatBox}>
                {messages.map((msg, index) => (
                    <div key={index} style={msg.sender === 'You' ? styles.userMessage : styles.aiMessage}>
                        <strong>{msg.sender}:</strong> {msg.text}
                    </div>
                ))}
            </div>
            {!recording && connected && (
                <div style={styles.status}>
                    <p>Status: Recording...</p>
                </div>
            )}
        </div>
    );
}

// Inline CSS styles for simplicity
const styles = {
    container: {
        padding: '20px',
        fontFamily: 'Arial, sans-serif'
    },
    buttonContainer: {
        marginBottom: '20px'
    },
    button: {
        padding: '10px 20px',
        marginRight: '10px',
        fontSize: '16px',
        cursor: 'pointer'
    },
    chatBox: {
        border: '1px solid #ccc',
        borderRadius: '5px',
        height: '400px',
        padding: '10px',
        overflowY: 'scroll',
        marginBottom: '20px'
    },
    userMessage: {
        textAlign: 'right',
        margin: '10px 0'
    },
    aiMessage: {
        textAlign: 'left',
        margin: '10px 0'
    },
    inputContainer: {
        display: 'flex'
    },
    input: {
        flex: 1,
        padding: '10px',
        fontSize: '16px'
    },
    sendButton: {
        padding: '10px 20px',
        fontSize: '16px',
        cursor: 'pointer'
    },
    status: {
        marginTop: '10px',
        color: 'green',
        fontWeight: 'bold'
    }
};

export default App;
