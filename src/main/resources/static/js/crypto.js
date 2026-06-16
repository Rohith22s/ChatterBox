// Web Crypto API Wrapper for E2EE

const CryptoUtils = {
    // Generate RSA-OAEP Key Pair for key exchange
    generateKeyPair: async function() {
        return await window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256",
            },
            true,
            ["encrypt", "decrypt"]
        );
    },

    // Export public key to base64 string for sending to server
    exportPublicKey: async function(key) {
        const exported = await window.crypto.subtle.exportKey("spki", key);
        return this.arrayBufferToBase64(exported);
    },

    // Import base64 public key from server
    importPublicKey: async function(base64Key) {
        const binaryDer = this.base64ToArrayBuffer(base64Key);
        return await window.crypto.subtle.importKey(
            "spki",
            binaryDer,
            {
                name: "RSA-OAEP",
                hash: "SHA-256"
            },
            true,
            ["encrypt"]
        );
    },

    // Generate a random AES-GCM key for encrypting a single message
    generateAESKey: async function() {
        return await window.crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    },

    // Encrypt a message string for a specific recipient using their public key
    encryptMessage: async function(message, recipientPublicKey) {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        
        // 1. Generate one-time AES key
        const aesKey = await this.generateAESKey();
        
        // 2. Encrypt message with AES key
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedContent = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            aesKey,
            data
        );
        
        // 3. Export the AES key
        const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
        
        // 4. Encrypt the AES key with the recipient's RSA public key
        const encryptedAesKey = await window.crypto.subtle.encrypt(
            {
                name: "RSA-OAEP"
            },
            recipientPublicKey,
            rawAesKey
        );
        
        return {
            content: this.arrayBufferToBase64(encryptedContent),
            key: this.arrayBufferToBase64(encryptedAesKey),
            iv: this.arrayBufferToBase64(iv)
        };
    },

    // Decrypt a received payload using our private key
    decryptMessage: async function(encryptedPayload, myPrivateKey) {
        // 1. Decrypt the AES key using our RSA private key
        const encryptedAesKeyBuf = this.base64ToArrayBuffer(encryptedPayload.key);
        const rawAesKey = await window.crypto.subtle.decrypt(
            {
                name: "RSA-OAEP"
            },
            myPrivateKey,
            encryptedAesKeyBuf
        );
        
        // 2. Import the decrypted AES key
        const aesKey = await window.crypto.subtle.importKey(
            "raw",
            rawAesKey,
            {
                name: "AES-GCM"
            },
            false,
            ["decrypt"]
        );
        
        // 3. Decrypt the message content using the AES key
        const encryptedContentBuf = this.base64ToArrayBuffer(encryptedPayload.content);
        const iv = this.base64ToArrayBuffer(encryptedPayload.iv);
        
        const decryptedContentBuf = await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: new Uint8Array(iv)
            },
            aesKey,
            encryptedContentBuf
        );
        
        const decoder = new TextDecoder();
        return decoder.decode(decryptedContentBuf);
    },

    // Utility functions
    arrayBufferToBase64: function(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    },

    base64ToArrayBuffer: function(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }
};
