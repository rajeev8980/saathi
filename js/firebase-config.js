// ============================================================
//  Saathi — Firebase configuration (auto-generated)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCekpogL0U8nKpT6k9yZxmJxMdO8isJ_3s",
  authDomain: "saathi-2407f.firebaseapp.com",
  projectId: "saathi-2407f",
  storageBucket: "saathi-2407f.firebasestorage.app",
  messagingSenderId: "405572416904",
  appId: "1:405572416904:web:df0c555135a59f8b2df63d"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
