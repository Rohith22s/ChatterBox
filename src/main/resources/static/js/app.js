let stompClient = null;
let currentUsername = null;
let jwtToken = null;
let myPrivateKey = null;
let contacts = [];
let currentChatUser = null;
let currentUserId = null;
let onlineUsers = new Set();
let unreadCounts = {};
let chatHistories = {}; // Store chat messages locally { username: [{text, type}] }
let userPublicKeys = {}; // Store public keys of other users
let myPublicKeyStr = null;

// WebRTC State
let peerConnection = null;
let localStream = null;
const configuration = {
    'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'}
    ]
};

let storageWarningShown = false;

function saveChatHistories() {
    try {
        const dataStr = JSON.stringify(chatHistories);
        if (dataStr.length > 4000000 && !storageWarningShown) {
            alert('Warning: Browser storage is getting full. Please clear some chat histories soon.');
            storageWarningShown = true;
        } else if (dataStr.length < 3000000) {
            storageWarningShown = false;
        }
        sessionStorage.setItem('chatHistories', dataStr);
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            console.warn('Session storage full, clearing chat histories...');
            chatHistories = {};
            sessionStorage.removeItem('chatHistories');
            alert('Browser memory was full. Previous chats have been deleted.');
            if (currentChatUser) {
                document.getElementById('chat-messages').innerHTML = '<div class="system-message">Chat history cleared due to memory limits.</div>';
            }
        } else {
            console.error('Failed to save chat histories', e);
        }
    }
}

// IndexedDB for storing our private key securely
const DB_NAME = 'ChatterboxDB';
const STORE_NAME = 'keys';

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

async function saveKeyToDB(username, privateKey) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(privateKey, username + '_private');
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e);
    });
}

async function getKeyFromDB(username) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(username + '_private');
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e);
    });
}

async function deleteKeyFromDB(username) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(username + '_private');
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
    });
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('auth-submit-btn').textContent = tab === 'login' ? 'Login' : 'Register';
    document.getElementById('auth-error').textContent = '';
}

async function handleAuth(event) {
    event.preventDefault();
    const btnText = document.getElementById('auth-submit-btn').textContent;
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');

    if (!username || !password) return;

    try {
        if (btnText === 'Register') {
            // 1. Generate Key Pair
            const keyPair = await CryptoUtils.generateKeyPair();
            myPrivateKey = keyPair.privateKey;
            
            // 2. Export Public Key
            myPublicKeyStr = await CryptoUtils.exportPublicKey(keyPair.publicKey);
            
            // 3. Save Private Key to IndexedDB
            await saveKeyToDB(username, myPrivateKey);

            // 4. Send to server
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, publicKey: myPublicKeyStr })
            });
            
            if (!response.ok) throw new Error((await response.json()).error || 'Registration failed');
            
            const data = await response.json();
            loginSuccess(data.username, data.token, data.userId);

        } else {
            // Login
            // First, see if we have the private key locally
            myPrivateKey = await getKeyFromDB(username);
            
            let loginBody = { username, password };
            
            // If missing, generate a new one for this device to avoid lockout
            if (!myPrivateKey) {
                console.log("Private key not found locally. Generating a new keypair for this device.");
                const keyPair = await CryptoUtils.generateKeyPair();
                myPrivateKey = keyPair.privateKey;
                myPublicKeyStr = await CryptoUtils.exportPublicKey(keyPair.publicKey);
                await saveKeyToDB(username, myPrivateKey);
                
                // Attach the new public key so the server updates it
                loginBody.publicKey = myPublicKeyStr;
            }

            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(loginBody)
            });
            
            if (!response.ok) throw new Error((await response.json()).error || 'Login failed');
            
            const data = await response.json();
            loginSuccess(data.username, data.token, data.userId);
        }
    } catch (err) {
        errorEl.textContent = err.message;
    }
}

function loginSuccess(username, token, userId) {
    currentUsername = username;
    jwtToken = token;
    currentUserId = userId;
    
    sessionStorage.setItem('currentUsername', username);
    sessionStorage.setItem('jwtToken', token);
    if(userId) sessionStorage.setItem('currentUserId', userId);
    
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('chat-section').classList.remove('hidden');
    
    document.getElementById('my-username').textContent = username;
    if(userId) document.getElementById('my-userid').textContent = 'ID: ' + userId;
    document.getElementById('my-avatar').textContent = username.charAt(0).toUpperCase();

    connectWebSocket();
    fetchOnlineUsers();
    fetchContacts();
}

async function fetchOnlineUsers() {
    try {
        const response = await fetch('/api/contacts/online', {
            headers: { 'Authorization': 'Bearer ' + jwtToken }
        });
        if (response.ok) {
            const users = await response.json();
            onlineUsers = new Set(users);
            renderContacts();
        }
    } catch (err) {
        console.error('Failed to fetch online users', err);
    }
}

function connectWebSocket() {
    const socket = new SockJS('/ws');
    stompClient = Stomp.over(socket);
    stompClient.debug = null; // Disable debug logging
    
    // Connect with JWT token
    stompClient.connect({ 'Authorization': 'Bearer ' + jwtToken }, function (frame) {
        // Subscribe to personal message queue
        stompClient.subscribe('/user/queue/messages', onMessageReceived);
        
        // Subscribe to public presence topic
        stompClient.subscribe('/topic/presence', (payload) => {
            const data = JSON.parse(payload.body);
            if (data.online) {
                onlineUsers.add(data.username);
            } else {
                onlineUsers.delete(data.username);
            }
            renderContacts();
        });
        
        // Subscribe to system notifications
        stompClient.subscribe('/user/queue/system', (payload) => {
            const data = JSON.parse(payload.body);
            if (data.type === 'CONTACT_UPDATE') {
                fetchContacts();
            }
        });
    }, function(error) {
        console.error('STOMP error:', error);
        alert('Disconnected from chat server.');
    });
}

async function onMessageReceived(payload) {
    const message = JSON.parse(payload.body);
    
    if (message.senderId === currentUsername) return; // Ignore our own echoes if any

    // Handle system payloads (unencrypted)
    if (message.systemPayload === 'KEY_MISMATCH') {
        console.warn(`User ${message.senderId} reported a key mismatch. Fetching new key.`);
        try {
            const response = await fetch(`/api/auth/keys/${message.senderId}`, {
                headers: { 'Authorization': 'Bearer ' + jwtToken }
            });
            if (response.ok) {
                const data = await response.json();
                userPublicKeys[message.senderId] = await CryptoUtils.importPublicKey(data.publicKey);
            }
        } catch (e) { console.error(e); }
        return; // Don't process further
    }
    
    if (message.systemPayload === 'READ_RECEIPT') {
        if (currentChatUser === message.senderId) {
            const indicators = document.querySelectorAll('.message.sent .seen-indicator');
            indicators.forEach(ind => {
                ind.textContent = ' ✓✓';
                ind.style.color = '#34b7f1';
            });
        }
        if (chatHistories[message.senderId]) {
            chatHistories[message.senderId].forEach(msg => {
                if (msg.type === 'sent') {
                    msg.status = 'seen';
                }
            });
            saveChatHistories();
        }
        return;
    }

    // We received an encrypted message
    try {
        const decryptedContent = await CryptoUtils.decryptMessage(message.encryptedPayload, myPrivateKey);
        
        let isJson = false;
        let signalData = null;
        try {
            signalData = JSON.parse(decryptedContent);
            if (signalData && signalData.type && (signalData.type.startsWith('RTC_') || signalData.type.startsWith('GAME_'))) {
                isJson = true;
            }
        } catch(e) {}

        if (isJson) {
            if (signalData.type.startsWith('RTC_')) {
                handleSignalingMessage(message.senderId, signalData);
            } else if (signalData.type.startsWith('GAME_')) {
                handleGameMessage(message.senderId, signalData);
            }
            return;
        }

        if (!chatHistories[message.senderId]) {
            chatHistories[message.senderId] = [];
        }
        chatHistories[message.senderId].push({ text: decryptedContent, type: 'received' });
        saveChatHistories();

        // If we have the chat open with the sender, append the message
        if (currentChatUser === message.senderId) {
            appendMessage(decryptedContent, 'received');
            if (stompClient) {
                stompClient.send("/app/chat", {}, JSON.stringify({
                    recipientId: message.senderId,
                    senderId: currentUsername,
                    systemPayload: 'READ_RECEIPT'
                }));
            }
        } else {
            // Increment unread count
            unreadCounts[message.senderId] = (unreadCounts[message.senderId] || 0) + 1;
            renderContacts();
            
            // Show notification or unread badge on contact
            const contactEl = document.getElementById('contact-' + message.senderId);
            if(contactEl) {
                contactEl.style.fontWeight = 'bold';
                contactEl.style.color = 'var(--primary)';
            }
        }
    } catch (err) {
        console.error('Failed to decrypt message:', err);
        // If decryption fails, it might be because they changed their key!
        // Clear the cached key so we fetch the new one next time we send them a message.
        delete userPublicKeys[message.senderId];
        
        // Notify sender that their key is outdated
        if (stompClient) {
            stompClient.send("/app/chat", {}, JSON.stringify({
                recipientId: message.senderId,
                senderId: currentUsername,
                systemPayload: 'KEY_MISMATCH'
            }));
        }
        
        const errorMsg = "⚠️ Could not decrypt message. (Sender key changed?)";
        if (!chatHistories[message.senderId]) {
            chatHistories[message.senderId] = [];
        }
        chatHistories[message.senderId].push({ text: errorMsg, type: 'received' });
        saveChatHistories();

        if (currentChatUser === message.senderId) {
            appendMessage(errorMsg, 'received');
        }
    }
}

async function fetchContacts() {
    try {
        const response = await fetch('/api/contacts', {
            headers: { 'Authorization': 'Bearer ' + jwtToken }
        });
        contacts = await response.json();
        renderContacts();
    } catch (err) {
        console.error('Failed to fetch contacts', err);
    }
}

function renderContacts() {
    const reqList = document.getElementById('requests-list');
    const friendsList = document.getElementById('friends-list');
    const bellBadge = document.getElementById('mobile-bell-badge');
    
    if (reqList) reqList.innerHTML = '';
    if (friendsList) friendsList.innerHTML = '';
    
    if (contacts.pendingReceived && contacts.pendingReceived.length > 0) {
        if(bellBadge) {
            bellBadge.textContent = contacts.pendingReceived.length;
            bellBadge.classList.remove('hidden');
        }
        contacts.pendingReceived.forEach(user => {
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.innerHTML = `
                <div class="avatar" style="width:30px;height:30px;font-size:0.9rem">${user.charAt(0).toUpperCase()}</div>
                <span>${user}</span>
                <button class="accept-btn" onclick="acceptFriendRequest('${user}', event)">Accept</button>
            `;
            reqList.appendChild(div);
        });
    } else {
        if(bellBadge) bellBadge.classList.add('hidden');
        if (reqList) {
            reqList.innerHTML = '<div style="padding:10px; color:var(--text-muted); font-size:0.8rem;">No pending requests.</div>';
        }
    }

    if (contacts.friends && contacts.friends.length > 0) {
        contacts.friends.forEach(user => {
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.id = 'contact-' + user;
            
            const isOnline = onlineUsers.has(user);
            const dotHtml = isOnline ? '<div class="online-dot"></div>' : '';
            
            const unreads = unreadCounts[user] || 0;
            const badgeHtml = unreads > 0 ? `<div class="unread-badge">${unreads}</div>` : '';
            
            div.innerHTML = `
                <div class="avatar" style="width:30px;height:30px;font-size:0.9rem">
                    ${user.charAt(0).toUpperCase()}
                    ${dotHtml}
                </div>
                <span>${user}</span>
                ${badgeHtml}
            `;
            div.onclick = () => selectContact(user);
            friendsList.appendChild(div);
        });
    } else if (friendsList) {
        friendsList.innerHTML = '<div class="contact-item">No friends yet. Add one above!</div>';
    }
}

async function sendFriendRequest() {
    const input = document.getElementById('add-contact-input');
    const targetUser = input.value.trim();
    if (!targetUser) return;
    
    try {
        const response = await fetch('/api/contacts/request', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwtToken 
            },
            body: JSON.stringify({ userId: targetUser })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        alert("Friend request sent to " + targetUser);
        input.value = '';
        fetchContacts();
    } catch (err) {
        alert("Error: " + err.message);
    }
}

async function acceptFriendRequest(senderUsername, event) {
    if(event) event.stopPropagation();
    try {
        const response = await fetch('/api/contacts/accept', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwtToken 
            },
            body: JSON.stringify({ username: senderUsername })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        fetchContacts(); // Refresh lists
    } catch (err) {
        alert("Error: " + err.message);
    }
}

async function selectContact(username) {
    currentChatUser = username;
    
    // Clear unread count when opening
    if (unreadCounts[username]) {
        unreadCounts[username] = 0;
        renderContacts();
        if (stompClient) {
            stompClient.send("/app/chat", {}, JSON.stringify({
                recipientId: username,
                senderId: currentUsername,
                systemPayload: 'READ_RECEIPT'
            }));
        }
    }
    
    // Update UI
    document.querySelectorAll('.contact-item').forEach(el => {
        el.classList.remove('active');
        el.style.fontWeight = 'normal';
        el.style.color = '';
    });
    document.getElementById('contact-' + username).classList.add('active');
    
    document.getElementById('current-chat-name').textContent = username;
    document.getElementById('current-chat-avatar').textContent = username.charAt(0).toUpperCase();
    document.getElementById('remove-contact-btn').classList.remove('hidden');
    document.getElementById('chat-messages').innerHTML = '<div class="system-message">Chat is end-to-end encrypted.</div>';
    
    if (chatHistories[username]) {
        chatHistories[username].forEach(msg => appendMessage(msg.text, msg.type, msg.status));
    }

    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('img-btn').disabled = false;
    document.getElementById('record-btn').disabled = false;
    document.getElementById('call-btn').classList.remove('hidden');
    document.getElementById('video-btn').classList.remove('hidden');
    document.getElementById('game-btn').classList.remove('hidden');
    document.getElementById('hangup-btn').classList.add('hidden');
    document.getElementById('clear-chat-btn').classList.remove('hidden');
    document.getElementById('message-input').focus();
    
    // Mobile view toggles
    document.getElementById('chat-section').classList.add('mobile-hide-sidebar', 'mobile-show-chat');

    // Fetch their public key if we don't have it
    if (!userPublicKeys[username]) {
        try {
            const response = await fetch(`/api/auth/keys/${username}`, {
                headers: { 'Authorization': 'Bearer ' + jwtToken }
            });
            if (response.ok) {
                const data = await response.json();
                userPublicKeys[username] = await CryptoUtils.importPublicKey(data.publicKey);
            } else {
                appendMessage('⚠️ User public key not found (account may have been deleted).', 'received');
                document.getElementById('message-input').disabled = true;
                document.getElementById('send-btn').disabled = true;
            }
        } catch (err) {
            console.error('Failed to get public key for', username);
            appendMessage('⚠️ Could not securely connect to user.', 'received');
            document.getElementById('message-input').disabled = true;
            document.getElementById('send-btn').disabled = true;
        }
    }
}

async function sendMessage(event) {
    event.preventDefault();
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !currentChatUser || !stompClient) return;
    
    let recipientPubKey = userPublicKeys[currentChatUser];
    if (!recipientPubKey) {
        // Try to fetch it if missing
        try {
            const response = await fetch(`/api/auth/keys/${currentChatUser}`, {
                headers: { 'Authorization': 'Bearer ' + jwtToken }
            });
            if (response.ok) {
                const data = await response.json();
                recipientPubKey = await CryptoUtils.importPublicKey(data.publicKey);
                userPublicKeys[currentChatUser] = recipientPubKey;
            }
        } catch (e) {
            console.error(e);
        }
        if (!recipientPubKey) {
            alert("Could not fetch recipient's secure key.");
            return;
        }
    }

    if (!chatHistories[currentChatUser]) {
            chatHistories[currentChatUser] = [];
    }
    chatHistories[currentChatUser].push({ text: content, type: 'sent' });
    saveChatHistories();

    // Clear input and append our message to UI immediately
    input.value = '';
    appendMessage(content, 'sent');

    try {
        // Encrypt the message
        const encryptedPayload = await CryptoUtils.encryptMessage(content, recipientPubKey);
        
        // Construct the message object
        const chatMessage = {
            recipientId: currentChatUser,
            senderId: currentUsername,
            encryptedPayload: encryptedPayload
        };

        // Send via WebSocket
        stompClient.send("/app/chat", {}, JSON.stringify(chatMessage));
        
    } catch (err) {
        console.error('Encryption failed', err);
        appendMessage('⚠️ Failed to encrypt and send message.', 'sent');
    }
}

async function sendImage() {
    const input = document.getElementById('image-upload');
    const file = input.files[0];
    if (!file || !currentChatUser || !stompClient) return;

    let recipientPubKey = userPublicKeys[currentChatUser];
    if (!recipientPubKey) {
        try {
            const response = await fetch(`/api/auth/keys/${currentChatUser}`, {
                headers: { 'Authorization': 'Bearer ' + jwtToken }
            });
            if (response.ok) {
                const data = await response.json();
                recipientPubKey = await CryptoUtils.importPublicKey(data.publicKey);
                userPublicKeys[currentChatUser] = recipientPubKey;
            }
        } catch (e) { console.error(e); }
        if (!recipientPubKey) {
            alert("Could not fetch recipient's secure key.");
            return;
        }
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Image = e.target.result;
        
        if (!chatHistories[currentChatUser]) {
            chatHistories[currentChatUser] = [];
        }
        chatHistories[currentChatUser].push({ text: base64Image, type: 'sent' });
        saveChatHistories();

        appendMessage(base64Image, 'sent');
        input.value = ''; // clear input

        try {
            const encryptedPayload = await CryptoUtils.encryptMessage(base64Image, recipientPubKey);
            const chatMessage = {
                recipientId: currentChatUser,
                senderId: currentUsername,
                encryptedPayload: encryptedPayload
            };
            stompClient.send("/app/chat", {}, JSON.stringify(chatMessage));
        } catch (err) {
            console.error('Encryption failed', err);
            appendMessage('⚠️ Failed to encrypt and send image.', 'sent');
        }
    };
    reader.readAsDataURL(file);
}

function appendMessage(text, type, status) {
    const messagesEl = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `message ${type}`;
    
    if (text.startsWith('data:image/')) {
        const img = document.createElement('img');
        img.src = text;
        div.appendChild(img);
    } else if (text.startsWith('data:audio/')) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = text;
        div.appendChild(audio);
    } else {
        div.textContent = text;
    }
    
    if (type === 'sent') {
        const seenSpan = document.createElement('span');
        seenSpan.className = 'seen-indicator';
        if (status === 'seen') {
            seenSpan.textContent = ' ✓✓';
            seenSpan.style.color = '#34b7f1';
        } else {
            seenSpan.textContent = ' ✓';
            // Default color logic, assuming light/dark mode css or simple gray
            seenSpan.style.color = 'gray';
        }
        seenSpan.style.fontSize = '0.8rem';
        seenSpan.style.marginLeft = '5px';
        div.appendChild(seenSpan);
    }

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function logout() {
    hangUp(false);
    if (typeof isGameActive !== 'undefined' && isGameActive && typeof closeGame === 'function') {
        closeGame();
    }
    if (currentUsername) {
        deleteKeyFromDB(currentUsername).catch(err => console.error("Failed to delete key", err));
    }
    sessionStorage.clear();
    if (stompClient) stompClient.disconnect();
    
    jwtToken = null;
    currentUsername = null;
    currentUserId = null;
    myPrivateKey = null;
    currentChatUser = null;
    userPublicKeys = {};
    onlineUsers = new Set();
    unreadCounts = {};
    chatHistories = {};
    
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('chat-section').classList.add('hidden');
    
    // Reset mobile view toggles
    document.getElementById('chat-section').classList.remove('mobile-hide-sidebar', 'mobile-show-chat');
    document.getElementById('friend-requests-section').classList.remove('mobile-show-requests');
    document.getElementById('remove-contact-btn').classList.add('hidden');
    if (document.getElementById('clear-chat-btn')) document.getElementById('clear-chat-btn').classList.add('hidden');
    document.getElementById('current-chat-name').textContent = 'Select a contact';
    document.getElementById('current-chat-avatar').textContent = '?';
    document.getElementById('chat-messages').innerHTML = '';
    
    // Clear forms
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

async function deleteAccount() {
    if (!confirm("Are you absolutely sure you want to delete your account? This action cannot be undone and your messages will be lost forever.")) return;
    try {
        const response = await fetch('/api/auth/account', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + jwtToken }
        });
        if (!response.ok) throw new Error("Failed to delete account");
        logout();
        alert("Your account has been permanently deleted.");
    } catch (err) {
        alert(err.message);
    }
}

function closeChat() {
    if (typeof isGameActive !== 'undefined' && isGameActive && typeof closeGame === 'function') {
        closeGame();
    }
    currentChatUser = null;
    document.getElementById('current-chat-name').textContent = 'Select a contact';
    document.getElementById('current-chat-avatar').textContent = '?';
    document.getElementById('remove-contact-btn').classList.add('hidden');
    document.getElementById('chat-messages').innerHTML = '<div class="system-message">Select a user to start an end-to-end encrypted conversation.</div>';
    
    document.getElementById('message-input').disabled = true;
    document.getElementById('send-btn').disabled = true;
    document.getElementById('img-btn').disabled = true;
    document.getElementById('record-btn').disabled = true;
    document.getElementById('call-btn').classList.add('hidden');
    document.getElementById('video-btn').classList.add('hidden');
    document.getElementById('hangup-btn').classList.add('hidden');
    if (document.getElementById('clear-chat-btn')) document.getElementById('clear-chat-btn').classList.add('hidden');
    
    document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    
    // Mobile view toggles
    document.getElementById('chat-section').classList.remove('mobile-hide-sidebar', 'mobile-show-chat');
}

function toggleMobileRequests() {
    const reqSection = document.getElementById('friend-requests-section');
    if (reqSection) {
        reqSection.classList.toggle('mobile-show-requests');
    }
}

async function removeContact() {
    if (!currentChatUser) return;
    if (!confirm(`Are you sure you want to remove ${currentChatUser} from your friends list?`)) return;
    
    if (typeof isGameActive !== 'undefined' && isGameActive && typeof closeGame === 'function') {
        closeGame();
    }
    
    try {
        const response = await fetch('/api/contacts/remove', {
            method: 'DELETE',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwtToken 
            },
            body: JSON.stringify({ username: currentChatUser })
        });
        if (!response.ok) throw new Error("Failed to remove contact");
        
        // Reset chat window
        currentChatUser = null;
        document.getElementById('current-chat-name').textContent = 'Select a contact';
        document.getElementById('current-chat-avatar').textContent = '?';
        document.getElementById('chat-messages').innerHTML = '';
        document.getElementById('message-input').disabled = true;
        document.getElementById('send-btn').disabled = true;
        document.getElementById('img-btn').disabled = true;
        document.getElementById('record-btn').disabled = true;
        document.getElementById('video-btn').classList.add('hidden');
        document.getElementById('call-btn').classList.add('hidden');
        document.getElementById('remove-contact-btn').classList.add('hidden');
        if (document.getElementById('clear-chat-btn')) document.getElementById('clear-chat-btn').classList.add('hidden');
        
        fetchContacts();
    } catch (err) {
        alert(err.message);
    }
}

function clearCurrentChat() {
    if (!currentChatUser) return;
    if (confirm("Are you sure you want to clear the chat history with " + currentChatUser + "?")) {
        chatHistories[currentChatUser] = [];
        saveChatHistories();
        document.getElementById('chat-messages').innerHTML = '<div class="system-message">Chat history cleared.</div>';
    }
}

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('password');
    const iconPath = document.querySelector('#eye-icon path');
    const iconCircle = document.querySelector('#eye-icon circle');
    
    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        iconPath.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M2 2l20 20');
        if(iconCircle) iconCircle.setAttribute('display', 'none');
    } else {
        pwdInput.type = 'password';
        iconPath.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z');
        if(iconCircle) iconCircle.removeAttribute('display');
    }
}

// Auto-login on page refresh if session exists
window.onload = async function() {
    const savedUsername = sessionStorage.getItem('currentUsername');
    const savedToken = sessionStorage.getItem('jwtToken');
    const savedUserId = sessionStorage.getItem('currentUserId');
    const savedHistories = sessionStorage.getItem('chatHistories');
    
    if (savedHistories) {
        try {
            chatHistories = JSON.parse(savedHistories);
        } catch (e) {
            console.error("Failed to parse saved chat histories", e);
            chatHistories = {};
        }
    }
    
    if (savedUsername && savedToken) {
        try {
            myPrivateKey = await getKeyFromDB(savedUsername);
            if (myPrivateKey) {
                loginSuccess(savedUsername, savedToken, savedUserId);
            } else {
                logout(); // Private key lost, must re-login
            }
        } catch (e) {
            console.error("Failed to restore session", e);
            logout();
        }
    }
};

// --- WebRTC Voice Call Functions ---

async function sendSignalingMessage(msgObj) {
    let recipientPubKey = userPublicKeys[currentChatUser];
    if (!recipientPubKey) {
        try {
            const response = await fetch(`/api/auth/keys/${currentChatUser}`, {
                headers: { 'Authorization': 'Bearer ' + jwtToken }
            });
            if (response.ok) {
                const data = await response.json();
                recipientPubKey = await CryptoUtils.importPublicKey(data.publicKey);
                userPublicKeys[currentChatUser] = recipientPubKey;
            }
        } catch(e) {}
        if (!recipientPubKey) return;
    }
    
    try {
        const payloadStr = JSON.stringify(msgObj);
        const encryptedPayload = await CryptoUtils.encryptMessage(payloadStr, recipientPubKey);
        const chatMessage = {
            recipientId: currentChatUser,
            senderId: currentUsername,
            encryptedPayload: encryptedPayload
        };
        stompClient.send("/app/chat", {}, JSON.stringify(chatMessage));
    } catch(err) {
        console.error("Failed to send signaling", err);
    }
}

async function handleSignalingMessage(sender, data) {
    if (currentChatUser !== sender && data.type === 'RTC_OFFER') {
        // Just show incoming call modal globally
        document.getElementById('caller-name').textContent = sender;
        document.getElementById('caller-avatar').textContent = sender.charAt(0).toUpperCase();
        document.getElementById('incoming-call-modal').classList.remove('hidden');
        window.incomingOffer = data.offer;
        window.incomingCaller = sender;
        window.incomingIsVideo = data.isVideo || false;
        return;
    }

    if (data.type === 'RTC_OFFER') {
        document.getElementById('caller-name').textContent = sender;
        document.getElementById('caller-avatar').textContent = sender.charAt(0).toUpperCase();
        document.getElementById('incoming-call-modal').classList.remove('hidden');
        window.incomingOffer = data.offer;
        window.incomingCaller = sender;
        window.incomingIsVideo = data.isVideo || false;
    } else if (data.type === 'RTC_ANSWER') {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            appendMessage('📞 Call connected', 'system-message');
        }
    } else if (data.type === 'RTC_ICE_CANDIDATE') {
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(data.candidate);
            } catch(e) {
                console.error("Failed to add ICE", e);
            }
        }
    } else if (data.type === 'RTC_HANGUP') {
        hangUp(false);
    }
}

function setupPeerConnection() {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendSignalingMessage({
                type: 'RTC_ICE_CANDIDATE',
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = event => {
        if (event.track.kind === 'video') {
            const remoteVideo = document.getElementById('remote-video');
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
            }
        } else {
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio.srcObject !== event.streams[0]) {
                remoteAudio.srcObject = event.streams[0];
            }
        }
    };
}

let isVideoCallActive = false;

function toggleVideoExpand() {
    const overlay = document.getElementById('video-overlay');
    overlay.classList.toggle('expanded');
}

async function startCall(isVideo = false) {
    if (!currentChatUser) return;
    
    isVideoCallActive = isVideo;
    
    document.getElementById('call-btn').classList.add('hidden');
    document.getElementById('video-btn').classList.add('hidden');
    document.getElementById('hangup-btn').classList.remove('hidden');

    if (isVideo) {
        document.getElementById('video-overlay').classList.remove('hidden');
    }

    // Always fetch latest key before calling to prevent key mismatch
    try {
        const response = await fetch(`/api/auth/keys/${currentChatUser}`, {
            headers: { 'Authorization': 'Bearer ' + jwtToken }
        });
        if (response.ok) {
            const data = await response.json();
            userPublicKeys[currentChatUser] = await CryptoUtils.importPublicKey(data.publicKey);
        }
    } catch(e) {}

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
        
        if (isVideo) {
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = localStream;
        }

        setupPeerConnection();
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        sendSignalingMessage({
            type: 'RTC_OFFER',
            offer: offer,
            isVideo: isVideo
        });
        
        appendMessage(isVideo ? '📹 Video Calling ' + currentChatUser + '...' : '📞 Calling ' + currentChatUser + '...', 'system-message');
    } catch (err) {
        console.error('Failed to get local media', err);
        alert("Could not access camera/microphone.");
        hangUp();
    }
}

async function acceptCall() {
    document.getElementById('incoming-call-modal').classList.add('hidden');
    
    if (currentChatUser !== window.incomingCaller) {
        await selectContact(window.incomingCaller);
    } else {
        // Even if we are already on this contact, ensure we have the key
        if (!userPublicKeys[window.incomingCaller]) {
            try {
                const response = await fetch(`/api/auth/keys/${window.incomingCaller}`, {
                    headers: { 'Authorization': 'Bearer ' + jwtToken }
                });
                if (response.ok) {
                    const data = await response.json();
                    userPublicKeys[window.incomingCaller] = await CryptoUtils.importPublicKey(data.publicKey);
                }
            } catch(e) {}
        }
    }
    
    isVideoCallActive = window.incomingIsVideo;
    
    document.getElementById('call-btn').classList.add('hidden');
    document.getElementById('video-btn').classList.add('hidden');
    document.getElementById('hangup-btn').classList.remove('hidden');
    
    if (isVideoCallActive) {
        document.getElementById('video-overlay').classList.remove('hidden');
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoCallActive });
        
        if (isVideoCallActive) {
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = localStream;
        }

        setupPeerConnection();
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(window.incomingOffer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        sendSignalingMessage({
            type: 'RTC_ANSWER',
            answer: answer
        });
        
        appendMessage(isVideoCallActive ? '📹 Video Call connected' : '📞 Call connected', 'system-message');
    } catch(err) {
        console.error("Accept call failed", err);
        rejectCall();
    }
}

function rejectCall() {
    document.getElementById('incoming-call-modal').classList.add('hidden');
    if (window.incomingCaller) {
        // Send hangup specifically to caller
        const recipientPubKey = userPublicKeys[window.incomingCaller];
        if (recipientPubKey) {
            const payloadStr = JSON.stringify({ type: 'RTC_HANGUP' });
            CryptoUtils.encryptMessage(payloadStr, recipientPubKey).then(encryptedPayload => {
                const chatMessage = {
                    recipientId: window.incomingCaller,
                    senderId: currentUsername,
                    encryptedPayload: encryptedPayload
                };
                stompClient.send("/app/chat", {}, JSON.stringify(chatMessage));
            });
        }
    }
}

function hangUp(sendSignal = true) {
    if (sendSignal && currentChatUser) {
        sendSignalingMessage({ type: 'RTC_HANGUP' });
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) remoteAudio.srcObject = null;
    
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) remoteVideo.srcObject = null;
    
    const localVideo = document.getElementById('local-video');
    if (localVideo) localVideo.srcObject = null;
    
    document.getElementById('call-btn').classList.remove('hidden');
    document.getElementById('video-btn').classList.remove('hidden');
    document.getElementById('hangup-btn').classList.add('hidden');
    document.getElementById('incoming-call-modal').classList.add('hidden');
    document.getElementById('video-overlay').classList.add('hidden');
    document.getElementById('video-overlay').classList.remove('expanded');
    
    // Only append 'Call ended' if we were actually chatting
    if (currentChatUser) {
        appendMessage(isVideoCallActive ? '📹 Video Call ended' : '📞 Call ended', 'system-message');
    }
    isVideoCallActive = false;
}

// --- Voice Recording Functions ---
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function toggleRecording() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            const reader = new FileReader();
            reader.onloadend = async function() {
                const base64Audio = reader.result;
                await sendAudioMessage(base64Audio);
            };
            reader.readAsDataURL(audioBlob);
        };

        mediaRecorder.start();
        isRecording = true;
        
        // Change icon to stop (square)
        const recordIcon = document.getElementById('record-icon');
        if(recordIcon) {
            recordIcon.innerHTML = '<rect x="6" y="6" width="12" height="12"></rect>';
            recordIcon.style.color = 'red';
        }
    } catch (err) {
        console.error('Failed to access microphone for recording', err);
        alert('Could not access microphone.');
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        
        // Change icon back to mic
        const recordIcon = document.getElementById('record-icon');
        if(recordIcon) {
            recordIcon.innerHTML = '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>';
            recordIcon.style.color = '';
        }
    }
}

async function sendAudioMessage(base64Audio) {
    if (!currentChatUser || !stompClient) return;

    let recipientPubKey = userPublicKeys[currentChatUser];
    if (!recipientPubKey) {
        try {
            const response = await fetch(`/api/auth/keys/${currentChatUser}`, {
                headers: { 'Authorization': 'Bearer ' + jwtToken }
            });
            if (response.ok) {
                const data = await response.json();
                recipientPubKey = await CryptoUtils.importPublicKey(data.publicKey);
                userPublicKeys[currentChatUser] = recipientPubKey;
            }
        } catch(e) {}
        if (!recipientPubKey) {
            alert("Could not fetch recipient's secure key.");
            return;
        }
    }

    if (!chatHistories[currentChatUser]) {
        chatHistories[currentChatUser] = [];
    }
    chatHistories[currentChatUser].push({ text: base64Audio, type: 'sent' });
    saveChatHistories();

    appendMessage(base64Audio, 'sent');

    try {
        const encryptedPayload = await CryptoUtils.encryptMessage(base64Audio, recipientPubKey);
        const chatMessage = {
            recipientId: currentChatUser,
            senderId: currentUsername,
            encryptedPayload: encryptedPayload
        };
        stompClient.send("/app/chat", {}, JSON.stringify(chatMessage));
    } catch (err) {
        console.error('Encryption failed', err);
        appendMessage('⚠️ Failed to encrypt and send voice message.', 'sent');
    }
}

// --- Security / Screen Recording Prevention Hacks ---

// Prevent right-click context menu
document.addEventListener('contextmenu', event => event.preventDefault());

// Prevent keyboard shortcuts (PrintScreen, Ctrl+P, Ctrl+S, F12, etc.)
document.addEventListener('keydown', (e) => {
    // Prevent PrintScreen
    if (e.key === 'PrintScreen') {
        navigator.clipboard.writeText('');
        alert('Screenshots are disabled for security reasons.');
    }
    
    // Prevent Ctrl+P (Print), Ctrl+S (Save), Ctrl+C (Copy), Ctrl+Shift+I (DevTools), F12
    if ((e.ctrlKey && (e.key === 'p' || e.key === 's' || e.key === 'c')) || 
        (e.ctrlKey && e.shiftKey && e.key === 'I') || 
        e.key === 'F12') {
        e.preventDefault();
    }
});

// Prevent copying to clipboard
document.addEventListener('copy', (e) => {
    e.preventDefault();
    if (e.clipboardData) {
        e.clipboardData.setData('text/plain', '');
    }
});

// --- PWA Installation Logic ---
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can install the PWA
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) {
        installBtn.classList.remove('hidden');
    }
});

async function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        deferredPrompt = null;
        const installBtn = document.getElementById('install-app-btn');
        if (installBtn) {
            installBtn.classList.add('hidden');
        }
    }
}
