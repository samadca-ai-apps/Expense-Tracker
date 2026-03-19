import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = !!firebaseConfig.projectId && !!firebaseConfig.apiKey;

let app = null;
let db = null;
let auth = null;
let googleProvider = null;
let initError = null;

try {
  if (isFirebaseConfigured) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
  }
} catch (error: any) {
  console.error("Firebase initialization error:", error);
  initError = error.message;
}

export { app, db, auth, googleProvider, initError };
