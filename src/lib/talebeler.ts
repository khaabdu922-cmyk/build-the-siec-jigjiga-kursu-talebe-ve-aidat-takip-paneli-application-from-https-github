import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  getDoc,
  setDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "./firebase";

export type SayfaKaydi = { t: number; sayfa: number };

export type KiraatYonu = "alttan" | "ustten";

export type Ders = "kuran" | "fikih" | "hadis";

export type Grup = "seviye1" | "seviye2" | "hazirlik";

export const GRUPLAR: { id: Grup; ad: string; hoca: string }[] = [
  { id: "seviye1", ad: "1. Seviye", hoca: "Abdurehim Hoca" },
  { id: "seviye2", ad: "2. Seviye", hoca: "Selahaddin Hoca" },
  { id: "hazirlik", ad: "Hazırlık", hoca: "Abdurrahman Hoca" },
];

export type Talebe = {
  id: string;
  isim: string;
  kiraat: boolean;
  kiraatGunler?: Record<string, number[]>;
  sayfa: number;
  hedefHaftalik?: number;
  gecmis: SayfaKaydi[];
  sira?: number;
  fotoUrl?: string;
  telefon?: string;
  dogum?: string;
  notlar?: string;
  yon?: KiraatYonu;
  fikihKonu?: number;
  fikihGunler?: Record<string, number[]>;
  hadisNo?: number;
  hadisGunler?: Record<string, number[]>;
  aidat?: Record<string, boolean>;
  grup?: Grup;
  sinif?: string;
  aidatSadece?: boolean;
  aidatHaric?: boolean;
};

const COL = "talebeler";

// ---- Paylaşımlı önbellek + tekil dinleyici ----
// Aynı veriyi kullanan bileşenler tek bir Firestore aboneliğini paylaşır;
// yeni abone olanlara son bilinen veri anında verilir.
const TALEBE_CACHE_KEY = "talebe-takip-cache-v1";

let talebeCache: Talebe[] | null = null;
let talebeUnsub: (() => void) | null = null;
const talebeAboneler = new Set<(t: Talebe[]) => void>();
const talebeHataAboneler = new Set<(e: Error) => void>();

function yereldenYukle(): Talebe[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TALEBE_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as Talebe[]) : null;
  } catch {
    return null;
  }
}

function yereleYaz(liste: Talebe[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TALEBE_CACHE_KEY, JSON.stringify(liste));
  } catch {}
}

function talebeCacheYaz(liste: Talebe[], kalici = true) {
  talebeCache = liste;
  if (kalici) yereleYaz(liste);
  talebeAboneler.forEach((f) => f(liste));
}

export function talebeleriOnbellektenOku(): Talebe[] | null {
  if (!talebeCache) talebeCache = yereldenYukle();
  return talebeCache;
}

export function talebeleriDinle(
  cb: (t: Talebe[]) => void,
  onError?: (e: Error) => void,
) {
  talebeAboneler.add(cb);
  if (onError) talebeHataAboneler.add(onError);

  // Stale-while-revalidate: önce önbellek, sonra canlı veri.
  const onbellek = talebeleriOnbellektenOku();
  if (onbellek) cb(onbellek);

  // Dinleyici bir kez kurulur ve açık kalır: diğer cihazlardaki
  // değişiklikler anında (saniyeler içinde) buraya düşer.
  if (!talebeUnsub) {
    talebeUnsub = baslatTalebeDinleyici();
  }

  return () => {
    talebeAboneler.delete(cb);
    if (onError) talebeHataAboneler.delete(onError);
  };
}

function baslatTalebeDinleyici() {
  const q = query(collection(db, COL), orderBy("sira", "asc"));
  return onSnapshot(
    q,
    (snap) => {
      const liste: Talebe[] = snap.docs.map((d) => {
        const v = d.data() as Partial<Talebe>;
        return {
          id: d.id,
          isim: v.isim ?? "Talebe",
          kiraat: !!v.kiraat,
          kiraatGunler:
            v.kiraatGunler && typeof v.kiraatGunler === "object"
              ? (v.kiraatGunler as Record<string, number[]>)
              : {},
          sayfa: typeof v.sayfa === "number" ? v.sayfa : 1,
          hedefHaftalik:
            typeof v.hedefHaftalik === "number" ? v.hedefHaftalik : 5,
          gecmis: Array.isArray(v.gecmis) ? v.gecmis : [],
          sira: typeof v.sira === "number" ? v.sira : 0,
          fotoUrl: typeof v.fotoUrl === "string" ? v.fotoUrl : undefined,
          telefon: typeof v.telefon === "string" ? v.telefon : undefined,
          dogum: typeof v.dogum === "string" ? v.dogum : undefined,
          notlar: typeof v.notlar === "string" ? v.notlar : undefined,
          yon: v.yon === "ustten" ? "ustten" : "alttan",
          fikihKonu: typeof v.fikihKonu === "number" ? v.fikihKonu : 1,
          fikihGunler:
            v.fikihGunler && typeof v.fikihGunler === "object"
              ? (v.fikihGunler as Record<string, number[]>)
              : {},
          hadisNo: typeof v.hadisNo === "number" ? v.hadisNo : 1,
          hadisGunler:
            v.hadisGunler && typeof v.hadisGunler === "object"
              ? (v.hadisGunler as Record<string, number[]>)
              : {},
          aidat:
            v.aidat && typeof v.aidat === "object"
              ? (v.aidat as Record<string, boolean>)
              : {},
          grup:
            v.grup === "seviye1" || v.grup === "seviye2" || v.grup === "hazirlik"
              ? v.grup
              : undefined,
          sinif: typeof v.sinif === "string" ? v.sinif : undefined,
          aidatSadece: v.aidatSadece === true,
          aidatHaric: v.aidatHaric === true,
        };
      });
      talebeCacheYaz(liste);
    },
    (err) => {
      console.error("Firestore dinleme hatası", err);
      talebeHataAboneler.forEach((f) => f(err));
    },
  );
}

// Sunucu yanıtı beklenmeden yerel listeyi/önbelleği günceller.
function iyimserUygula(
  degistir: (liste: Talebe[]) => Talebe[],
  kalici = false,
) {
  const mevcut = talebeleriOnbellektenOku();
  if (!mevcut) return;
  talebeCacheYaz(degistir(mevcut), kalici);
}

export async function talebeEkle(t: Omit<Talebe, "id">) {
  const gecici = `gecici-${Date.now()}`;
  iyimserUygula((l) =>
    [...l, { ...(t as Omit<Talebe, "id">), id: gecici } as Talebe].sort(
      (a, b) => (a.sira ?? 0) - (b.sira ?? 0),
    ),
  );
  const ref = await addDoc(collection(db, COL), t);
  return ref.id;
}

export async function talebeGuncelle(
  id: string,
  patch: Partial<Omit<Talebe, "id">>,
) {
  iyimserUygula(
    (l) => l.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    true,
  );
  await updateDoc(doc(db, COL, id), patch as Record<string, unknown>);
}

export async function talebeSil(id: string) {
  iyimserUygula((l) => l.filter((t) => t.id !== id), true);
  await deleteDoc(doc(db, COL, id));
}

export async function topluHedefGuncelle(ids: string[], hedef: number) {
  iyimserUygula(
    (l) =>
      l.map((t) => (ids.includes(t.id) ? { ...t, hedefHaftalik: hedef } : t)),
    true,
  );
  const batch = writeBatch(db);
  ids.forEach((id) =>
    batch.update(doc(db, COL, id), { hedefHaftalik: hedef }),
  );
  await batch.commit();
}

// ---- Aidat (aylık ödeme) ----

const AYAR_COL = "ayarlar";
const AYAR_DOC = "genel";

const AIDAT_CACHE_KEY = "aidat-tutar-cache-v1";

let aidatTutarCache: number | null = null;
let aidatUnsub: (() => void) | null = null;
const aidatAboneler = new Set<(t: number) => void>();

function aidatOnbellek(): number | null {
  if (aidatTutarCache !== null) return aidatTutarCache;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AIDAT_CACHE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    aidatTutarCache = Number.isFinite(n) ? n : null;
    return aidatTutarCache;
  } catch {
    return null;
  }
}

function aidatCacheYaz(tutar: number) {
  aidatTutarCache = tutar;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(AIDAT_CACHE_KEY, String(tutar));
    } catch {}
  }
}

export async function aidatTutariniOku(): Promise<number> {
  // Dinleyici açıksa ya da daha önce okunduysa ağ sorgusu yapılmaz.
  const onbellek = aidatOnbellek();
  if (onbellek !== null) return onbellek;
  try {
    const snap = await getDoc(doc(db, AYAR_COL, AYAR_DOC));
    const v = snap.data()?.aidatTutar;
    aidatTutarCache = typeof v === "number" ? v : 0;
    return aidatTutarCache;
  } catch {
    return 0;
  }
}

export function aidatTutariniDinle(cb: (tutar: number) => void) {
  aidatAboneler.add(cb);
  if (aidatTutarCache !== null) cb(aidatTutarCache);

  if (!aidatUnsub) {
    aidatUnsub = onSnapshot(doc(db, AYAR_COL, AYAR_DOC), (snap) => {
      const v = snap.data()?.aidatTutar;
      aidatTutarCache = typeof v === "number" ? v : 0;
      aidatAboneler.forEach((f) => f(aidatTutarCache as number));
    });
  }

  return () => {
    aidatAboneler.delete(cb);
    if (aidatAboneler.size === 0 && aidatUnsub) {
      aidatUnsub();
      aidatUnsub = null;
    }
  };
}

export async function aidatTutariKaydet(tutar: number) {
  aidatTutarCache = tutar;
  await setDoc(doc(db, AYAR_COL, AYAR_DOC), { aidatTutar: tutar }, { merge: true });
}

export async function aidatOdemeAyarla(
  t: Talebe,
  ayKey: string,
  odendi: boolean,
) {
  const harita = { ...(t.aidat ?? {}), [ayKey]: odendi };
  await talebeGuncelle(t.id, { aidat: harita });
}
