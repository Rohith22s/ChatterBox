package com.connect.chatter.controller;

import com.connect.chatter.service.PresenceService;
import com.google.cloud.firestore.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.*;
import java.util.concurrent.ExecutionException;

@RestController
@RequestMapping("/api/contacts")
public class ContactController {

    @Autowired(required = false)
    private Firestore firestore;

    @Autowired
    private PresenceService presenceService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @GetMapping("/online")
    public ResponseEntity<Set<String>> getOnlineUsers() {
        return ResponseEntity.ok(presenceService.getOnlineUsers());
    }

    private String getDocId(String user1, String user2) {
        if (user1.compareTo(user2) < 0) {
            return user1 + "_" + user2;
        } else {
            return user2 + "_" + user1;
        }
    }

    @PostMapping("/request")
    public ResponseEntity<?> sendRequest(@RequestBody Map<String, String> payload, Principal principal) throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        String sender = principal.getName();
        String targetUserId = payload.get("userId");

        if (targetUserId == null || targetUserId.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "User ID is required"));
        }

        // Look up receiver by userId
        QuerySnapshot query = firestore.collection("users").whereEqualTo("userId", targetUserId).get().get();
        if (query.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "User with that ID not found"));
        }

        String receiver = query.getDocuments().get(0).getId();

        if (sender.equals(receiver)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Cannot send request to yourself"));
        }

        String docId = getDocId(sender, receiver);
        DocumentReference docRef = firestore.collection("contacts").document(docId);
        DocumentSnapshot doc = docRef.get().get();

        if (doc.exists()) {
            String status = doc.getString("status");
            if ("ACCEPTED".equals(status)) {
                return ResponseEntity.badRequest().body(Map.of("error", "Already friends"));
            } else {
                return ResponseEntity.badRequest().body(Map.of("error", "Request already pending"));
            }
        }

        Map<String, Object> data = new HashMap<>();
        data.put("user1", sender.compareTo(receiver) < 0 ? sender : receiver);
        data.put("user2", sender.compareTo(receiver) > 0 ? sender : receiver);
        data.put("status", sender.equals(data.get("user1")) ? "PENDING_USER1" : "PENDING_USER2");

        docRef.set(data).get();
        
        messagingTemplate.convertAndSendToUser(receiver, "/queue/system", Map.of("type", "CONTACT_UPDATE"));
        
        return ResponseEntity.ok(Map.of("message", "Request sent"));
    }

    @PostMapping("/accept")
    public ResponseEntity<?> acceptRequest(@RequestBody Map<String, String> payload, Principal principal) throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        String receiver = principal.getName();
        String sender = payload.get("username");

        String docId = getDocId(sender, receiver);
        DocumentReference docRef = firestore.collection("contacts").document(docId);
        DocumentSnapshot doc = docRef.get().get();

        if (!doc.exists()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Request not found"));
        }

        String status = doc.getString("status");
        String expectedStatus = receiver.equals(doc.getString("user1")) ? "PENDING_USER2" : "PENDING_USER1";

        if ("ACCEPTED".equals(status)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Already accepted"));
        }

        if (!expectedStatus.equals(status)) {
            return ResponseEntity.badRequest().body(Map.of("error", "No incoming request to accept"));
        }

        docRef.update("status", "ACCEPTED").get();

        messagingTemplate.convertAndSendToUser(sender, "/queue/system", Map.of("type", "CONTACT_UPDATE"));

        return ResponseEntity.ok(Map.of("message", "Request accepted"));
    }

    @GetMapping
    public ResponseEntity<?> getContacts(Principal principal) throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        String username = principal.getName();

        // Firestore limitation: we can't easily query logical OR (user1 == X OR user2 == X) efficiently without composite indexes,
        // so we do two separate queries and merge them.
        QuerySnapshot query1 = firestore.collection("contacts").whereEqualTo("user1", username).get().get();
        QuerySnapshot query2 = firestore.collection("contacts").whereEqualTo("user2", username).get().get();

        List<String> friends = new ArrayList<>();
        List<String> pendingSent = new ArrayList<>();
        List<String> pendingReceived = new ArrayList<>();

        for (DocumentSnapshot doc : query1.getDocuments()) {
            String otherUser = doc.getString("user2");
            String status = doc.getString("status");
            if ("ACCEPTED".equals(status)) friends.add(otherUser);
            else if ("PENDING_USER1".equals(status)) pendingSent.add(otherUser);
            else if ("PENDING_USER2".equals(status)) pendingReceived.add(otherUser);
        }

        for (DocumentSnapshot doc : query2.getDocuments()) {
            String otherUser = doc.getString("user1");
            String status = doc.getString("status");
            if ("ACCEPTED".equals(status)) friends.add(otherUser);
            else if ("PENDING_USER2".equals(status)) pendingSent.add(otherUser);
            else if ("PENDING_USER1".equals(status)) pendingReceived.add(otherUser);
        }

        Map<String, List<String>> response = new HashMap<>();
        response.put("friends", friends);
        response.put("pendingSent", pendingSent);
        response.put("pendingReceived", pendingReceived);

        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/remove")
    public ResponseEntity<?> removeContact(@RequestBody Map<String, String> payload, Principal principal) throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        String currentUser = principal.getName();
        String targetUser = payload.get("username");

        if (targetUser == null || targetUser.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Target username is required"));
        }

        String docId = getDocId(currentUser, targetUser);
        DocumentReference docRef = firestore.collection("contacts").document(docId);
        
        if (!docRef.get().get().exists()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Contact not found"));
        }

        docRef.delete().get();

        messagingTemplate.convertAndSendToUser(targetUser, "/queue/system", Map.of("type", "CONTACT_UPDATE"));

        return ResponseEntity.ok(Map.of("message", "Contact removed"));
    }
}
