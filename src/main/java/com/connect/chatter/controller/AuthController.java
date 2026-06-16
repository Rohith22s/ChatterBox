package com.connect.chatter.controller;

import com.connect.chatter.security.JwtUtils;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.QuerySnapshot;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ExecutionException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private JwtUtils jwtUtils;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired(required = false)
    private Firestore firestore;

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody Map<String, String> request) throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        String username = request.get("username");
        String password = request.get("password");
        String publicKey = request.get("publicKey");

        DocumentReference docRef = firestore.collection("users").document(username);
        if (docRef.get().get().exists()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Username already exists"));
        }

        Map<String, Object> userData = new HashMap<>();
        
        // Generate random 6-digit user ID
        String userId = String.format("%06d", new Random().nextInt(1000000));
        
        userData.put("password", passwordEncoder.encode(password));
        userData.put("publicKey", publicKey);
        userData.put("userId", userId);

        docRef.set(userData).get();

        String token = jwtUtils.generateToken(username);
        return ResponseEntity.ok(Map.of("token", token, "username", username, "userId", userId));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> request) throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        String username = request.get("username");
        String password = request.get("password");

        DocumentSnapshot document = firestore.collection("users").document(username).get().get();

        if (!document.exists() || !passwordEncoder.matches(password, document.getString("password"))) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid credentials"));
        }

        // If the user logs in from a new device, they might send a new public key
        if (request.containsKey("publicKey")) {
            firestore.collection("users").document(username).update("publicKey", request.get("publicKey")).get();
        }
        
        String userId = document.getString("userId");
        if (userId == null) userId = "N/A"; // Fallback for old accounts

        String token = jwtUtils.generateToken(username);
        return ResponseEntity.ok(Map.of("token", token, "username", username, "userId", userId));
    }

    @GetMapping("/keys/{username}")
    public ResponseEntity<?> getPublicKey(@PathVariable String username) throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        DocumentSnapshot document = firestore.collection("users").document(username).get().get();
        if (!document.exists()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of("publicKey", document.getString("publicKey")));
    }

    @GetMapping("/users")
    public ResponseEntity<?> getAllUsers() throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        QuerySnapshot query = firestore.collection("users").get().get();
        List<String> users = new ArrayList<>();
        query.getDocuments().forEach(doc -> users.add(doc.getId()));

        return ResponseEntity.ok(users);
    }

    @DeleteMapping("/account")
    public ResponseEntity<?> deleteAccount(Principal principal) throws ExecutionException, InterruptedException {
        if (firestore == null) return ResponseEntity.internalServerError().body(Map.of("error", "Database not configured"));

        String username = principal.getName();
        
        // 1. Delete user document
        firestore.collection("users").document(username).delete().get();
        
        // 2. Cleanup contacts where this user is involved
        QuerySnapshot query1 = firestore.collection("contacts").whereEqualTo("user1", username).get().get();
        for (DocumentSnapshot doc : query1.getDocuments()) {
            doc.getReference().delete();
        }
        
        QuerySnapshot query2 = firestore.collection("contacts").whereEqualTo("user2", username).get().get();
        for (DocumentSnapshot doc : query2.getDocuments()) {
            doc.getReference().delete();
        }
        
        return ResponseEntity.ok(Map.of("message", "Account deleted"));
    }
}
