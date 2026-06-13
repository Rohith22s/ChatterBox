package com.connect.chatter.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessageSendingOperations;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.security.Principal;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class PresenceService {

    private final Map<String, Boolean> onlineUsers = new ConcurrentHashMap<>();

    @Autowired
    private SimpMessageSendingOperations messagingTemplate;

    @EventListener
    public void handleSessionConnected(SessionConnectEvent event) {
        Principal user = event.getUser();
        if (user != null) {
            String username = user.getName();
            onlineUsers.put(username, true);
            Object payload = Map.of("username", username, "online", true);
            messagingTemplate.convertAndSend("/topic/presence", payload);
        }
    }

    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        Principal user = event.getUser();
        if (user != null) {
            String username = user.getName();
            onlineUsers.remove(username);
            Object payload = Map.of("username", username, "online", false);
            messagingTemplate.convertAndSend("/topic/presence", payload);
        }
    }

    public Set<String> getOnlineUsers() {
        return onlineUsers.keySet();
    }
}
