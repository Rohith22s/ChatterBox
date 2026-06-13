package com.connect.chatter.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.Firestore;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.cloud.FirestoreClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.FileInputStream;
import java.io.IOException;

@Configuration
public class FirebaseConfig {

    @Bean
    public Firestore firestore() throws IOException {
        if (FirebaseApp.getApps().isEmpty()) {
            java.io.InputStream serviceAccount;
            String firebaseCreds = System.getenv("FIREBASE_CREDENTIALS");
            if (firebaseCreds != null && !firebaseCreds.isEmpty()) {
                serviceAccount = new java.io.ByteArrayInputStream(firebaseCreds.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            } else {
                serviceAccount = new FileInputStream("src/main/resources/firebase-service-account.json");
            }

            FirebaseOptions options = FirebaseOptions.builder()
                    .setCredentials(GoogleCredentials.fromStream(serviceAccount))
                    .build();

            FirebaseApp.initializeApp(options);
            System.out.println("Firebase Admin SDK initialized successfully.");
        }
        
        return FirestoreClient.getFirestore();
    }
}
