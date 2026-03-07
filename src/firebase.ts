import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

export const isFirebaseConfigured = !!firebaseConfig.projectId && !!firebaseConfig.apiKey;

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const db = isFirebaseConfigured ? getFirestore(app!) : null;
