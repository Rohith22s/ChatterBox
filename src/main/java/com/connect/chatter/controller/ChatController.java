package com.connect.chatter.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.Map;

@Controller
public class ChatController {

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @MessageMapping("/chat")
    public void processMessage(@Payload Map<String, Object> chatMessage, Principal principal) {
        String recipientId = (String) chatMessage.get("recipientId");
        String senderId = principal != null ? principal.getName() : (String) chatMessage.get("senderId");
        
        chatMessage.put("senderId", senderId);

        // Send encrypted payload to the recipient's personal queue
        messagingTemplate.convertAndSendToUser(
                recipientId, "/queue/messages", chatMessage
        );
    }
}
