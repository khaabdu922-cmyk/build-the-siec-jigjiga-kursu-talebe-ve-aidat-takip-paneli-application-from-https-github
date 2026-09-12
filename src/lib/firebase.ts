import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDvJEa6olx2JX7YrsVbR0ZIwX7eJ90-T8E",
  authDomain: "dessie-talabe-takibi-verileri.firebaseapp.com",
  projectId: "dessie-talabe-takibi-verileri",
  storageBucket: "dessie-talabe-takibi-verileri.firebasestorage.app",
  messagingSenderId: "607580070031",
  appId: "1:607580070031:web:1d6299c0aa025629d010fa",
  measurementId: "G-EBMKCK0SSY",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Tarayıcıda kalıcı (IndexedDB) önbellek: veriler anında yerelden gelir,
// gereksiz ağ sorguları yapılmaz. Sunucuda düz Firestore kullanılır.
function firestoreOlustur() {
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = firestoreOlustur();

// Analytics yalnızca tarayıcıda ve destekleniyorsa başlatılır.
if (typeof window !== "undefined") {
  void import("firebase/analytics")
    .then(async ({ getAnalytics, isSupported }) => {
      try {
        if (await isSupported()) getAnalytics(app);
      } catch {
        /* yoksay */
      }
    })
    .catch(() => {
      /* yoksay */
    });
}
