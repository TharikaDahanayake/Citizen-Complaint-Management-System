// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

// 🔹 Replace the values below with your Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyCr5xSS_xPQO38JHoZMufQl-HEltwCvqSk",
  authDomain: "complaint-management-sys-f5d5e.firebaseapp.com",
  projectId: "complaint-management-sys-f5d5e",
  storageBucket: "complaint-management-sys-f5d5e.firebasestorage.app",
  messagingSenderId: "697751596289",
  appId: "1:697751596289:web:cd218934e92411bd7a7f00"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize services
export const db = getFirestore(app);   // Firestore database
export const auth = getAuth(app);      // Firebase Authentication
export const storage = getStorage(app); // Firebase Storage

