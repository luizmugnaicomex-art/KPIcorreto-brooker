// This file configures and initializes Firebase.
// IMPORTANT: Replace the placeholder values below with your actual Firebase project configuration.
// You can find this configuration in your Firebase project settings.

import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyAxGCkCFV-Dm-rZdFbO0PSRPFB5jA5sY1c", // <-- REPLACE WITH YOUR API KEY
  authDomain: "teambrokerbyd.firebaseapp.com", // <-- REPLACE WITH YOUR AUTH DOMAIN
  projectId: "teambrokerbyd", // <-- REPLACE WITH YOUR PROJECT ID
  storageBucket: "teambrokerbyd.firebasestorage.app", // <-- REPLACE WITH YOUR STORAGE BUCKET
  messagingSenderId: "192503859895", // <-- REPLACE WITH YOUR MESSAGING SENDER ID
  appId: "1:192503859895:web:e9675df65e649d51ff1b32", // <-- REPLACE WITH YOUR APP ID
  measurementId: "G-VZD4CFSEFH"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const firestore = firebase.firestore();
export const auth = firebase.auth();
export const FieldValue = firebase.firestore.FieldValue;
export default firebase;