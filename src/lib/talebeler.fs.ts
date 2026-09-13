// Firestore ile konuşan ağır katman. Yalnızca ilk render'dan sonra
// (dinamik import ile) yüklenir; böylece ilk açılış bundle'ı küçük kalır.
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
import type { Talebe } from "./talebeler";

const COL = "talebeler";
const AYAR_COL = "ayarlar";
const AYAR_DOC = "genel";

function esle(id: string, v: Partial<Talebe>): Talebe {
  return {
    id,
    isim: v.isim ?? "Talebe",
    kiraat: !!v.kiraat,
    kiraatGunler:
      v.kiraatGunler && typeof v.kiraatGunler === "object"
        ? (v.kiraatGunler as Record<string, number[]>)
        : {},
    sayfa: typeof v.sayfa === "number" ? v.sayfa : 1,
    hedefHaftalik: typeof v.hedefHaftalik === "number" ? v.hedefHaftalik : 5,
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
    aidat: v.aidat && typeof v.aidat === "object" ? (v.aidat as Record<string, boolean>) : {},
    grup:
      v.grup === "seviye1" || v.grup === "seviye2" || v.grup === "hazirlik" ? v.grup : undefined,
    sinif: typeof v.sinif === "string" ? v.sinif : undefined,
    aidatSadece: v.aidatSadece === true,
    aidatHaric: v.aidatHaric === true,
  };
}

export function dinle(onData: (l: Talebe[]) => void, onError: (e: Error) => void) {
  const q = query(collection(db, COL), orderBy("sira", "asc"));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => esle(d.id, d.data() as Partial<Talebe>))),
    (err) => {
      console.error("Firestore dinleme hatası", err);
      onError(err);
    },
  );
}

export async function ekle(t: Omit<Talebe, "id">) {
  const ref = await addDoc(collection(db, COL), t);
  return ref.id;
}

export async function guncelle(id: string, patch: Partial<Omit<Talebe, "id">>) {
  await updateDoc(doc(db, COL, id), patch as Record<string, unknown>);
}

export async function sil(id: string) {
  await deleteDoc(doc(db, COL, id));
}

export async function topluHedef(ids: string[], hedef: number) {
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(db, COL, id), { hedefHaftalik: hedef }));
  await batch.commit();
}

export async function aidatOku(): Promise<number> {
  const snap = await getDoc(doc(db, AYAR_COL, AYAR_DOC));
  const v = snap.data()?.aidatTutar;
  return typeof v === "number" ? v : 0;
}

export function aidatDinle(cb: (tutar: number) => void) {
  return onSnapshot(doc(db, AYAR_COL, AYAR_DOC), (snap) => {
    const v = snap.data()?.aidatTutar;
    cb(typeof v === "number" ? v : 0);
  });
}

export async function aidatKaydet(tutar: number) {
  await setDoc(doc(db, AYAR_COL, AYAR_DOC), { aidatTutar: tutar }, { merge: true });
}
