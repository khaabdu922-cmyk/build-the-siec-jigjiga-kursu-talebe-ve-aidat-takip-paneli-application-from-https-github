import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
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

// Tarayıcıda kalıcı (IndexedDB) önbellek: uygulama açılır açılmaz veriler
// yerelden gösterilir, arka planda sunucudan tazelenir (stale-while-revalidate).
// Çok sekmeli kullanım da desteklenir.
function firestoreOlustur(): Firestore {
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // Zaten başlatılmışsa mevcut örneği kullan.
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
