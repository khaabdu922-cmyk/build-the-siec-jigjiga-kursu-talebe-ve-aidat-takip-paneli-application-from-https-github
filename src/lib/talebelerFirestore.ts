import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  writeBatch,
  getDoc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "./firebase";
import { cacheOku, cacheYaz, CACHE } from "./yerelCache";
import {
  GRUPLAR,
  type Grup,
  type GrupBilgi,
  type EkstraHoca,
  type HocaMailAyar,
  type Talebe,
} from "./talebelerTipler";

const COL = "talebeler";

// ---- Paylaşımlı talebe aboneliği (tek Firestore dinleyicisi) ----
let talebeSon: Talebe[] | null = null;
const talebeAbone = new Set<(t: Talebe[]) => void>();
const talebeHataAbone = new Set<(e: Error) => void>();
let talebeUnsub: (() => void) | null = null;

/**
 * Talebeleri dinler.
 * 1) Varsa yerel önbellekteki liste anında verilir (bekleme yok).
 * 2) Aynı anda tek bir Firestore dinleyicisi kullanılır; her yeni kayıt,
 *    düzenleme ve silme (kendi cihazında anında, diğer cihazlarda ~1 sn)
 *    otomatik olarak yayılır.
 */
export function talebeleriDinle(cb: (t: Talebe[]) => void, onError?: (e: Error) => void) {
  talebeAbone.add(cb);
  if (onError) talebeHataAbone.add(onError);

  const yerel = talebeSon ?? cacheOku<Talebe[]>(CACHE.talebeler);
  if (yerel && yerel.length > 0) {
    talebeSon = yerel;
    cb(yerel);
  }

  if (!talebeUnsub) {
    talebeUnsub = talebeleriDinleHam(
      (liste) => {
        talebeSon = liste;
        cacheYaz(CACHE.talebeler, liste);
        talebeAbone.forEach((f) => f(liste));
      },
      (e) => talebeHataAbone.forEach((f) => f(e)),
    );
  }

  return () => {
    talebeAbone.delete(cb);
    if (onError) talebeHataAbone.delete(onError);
  };
}

type HamDoc = { id: string; data: () => unknown };

function talebeCoz(docs: HamDoc[]): Talebe[] {
  return docs.map((d) => {
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
          grup: typeof v.grup === "string" && v.grup ? v.grup : undefined,

          sinif: typeof v.sinif === "string" ? v.sinif : undefined,
          aidatSadece: v.aidatSadece === true,
          aidatHaric: v.aidatHaric === true,
        };
  });
}

function talebeleriDinleHam(cb: (t: Talebe[]) => void, onError?: (e: Error) => void) {
  const q = query(collection(db, COL), orderBy("sira", "asc"));
  return onSnapshot(
    q,
    (snap) => cb(talebeCoz(snap.docs)),
    (err) => {
      console.error("Firestore dinleme hatası", err);
      onError?.(err);
    },
  );
}

/**
 * PDF / Excel çıktıları için verileri doğrudan sunucudan (önbelleksiz) okur.
 * Böylece indirilen dosya her zaman en güncel bilgileri içerir.
 * Sunucuya ulaşılamazsa eldeki en son liste döner.
 */
export async function talebeleriTazele(): Promise<Talebe[]> {
  try {
    const q = query(collection(db, COL), orderBy("sira", "asc"));
    const snap = await getDocsFromServer(q);
    const liste = talebeCoz(snap.docs);
    talebeSon = liste;
    cacheYaz(CACHE.talebeler, liste);
    talebeAbone.forEach((f) => f(liste));
    return liste;
  } catch {
    return talebeSon ?? cacheOku<Talebe[]>(CACHE.talebeler) ?? [];
  }
}

// Yerel listeyi ve önbelleği sunucu yanıtını beklemeden günceller
// (iyimser / optimistic güncelleme). Sunucudan gerçek veri gelince üzerine yazılır.
function talebeleriYerelUygula(donustur: (mevcut: Talebe[]) => Talebe[]) {
  const mevcut = talebeSon ?? cacheOku<Talebe[]>(CACHE.talebeler) ?? [];
  const yeni = donustur(mevcut);
  talebeSon = yeni;
  cacheYaz(CACHE.talebeler, yeni);
  talebeAbone.forEach((f) => f(yeni));
}

function siraliYaz(liste: Talebe[]) {
  return [...liste].sort((a, b) => (a.sira ?? 0) - (b.sira ?? 0));
}

export async function talebeEkle(t: Omit<Talebe, "id">) {
  const ref = doc(collection(db, COL));
  talebeleriYerelUygula((mevcut) => siraliYaz([...mevcut, { ...(t as Talebe), id: ref.id }]));
  await setDoc(ref, t as Record<string, unknown>);
  return ref.id;
}

export async function talebeGuncelle(id: string, patch: Partial<Omit<Talebe, "id">>) {
  talebeleriYerelUygula((mevcut) =>
    siraliYaz(mevcut.map((t) => (t.id === id ? { ...t, ...patch } : t))),
  );
  await updateDoc(doc(db, COL, id), patch as Record<string, unknown>);
}

export async function talebeSil(id: string) {
  talebeleriYerelUygula((mevcut) => mevcut.filter((t) => t.id !== id));
  await deleteDoc(doc(db, COL, id));
}

export async function topluHedefGuncelle(ids: string[], hedef: number) {
  const kume = new Set(ids);
  talebeleriYerelUygula((mevcut) =>
    mevcut.map((t) => (kume.has(t.id) ? { ...t, hedefHaftalik: hedef } : t)),
  );
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(db, COL, id), { hedefHaftalik: hedef }));
  await batch.commit();
}

// ---- Aidat (aylık ödeme) ----

const AYAR_COL = "ayarlar";
const AYAR_DOC = "genel";

export async function aidatTutariniOku(): Promise<number> {
  // Önce sunucudan (güncel) dener, ulaşılamazsa önbellekten okur.
  try {
    const snap = await getDocFromServer(doc(db, AYAR_COL, AYAR_DOC));
    const v = snap.data()?.["aidatTutar"];
    return typeof v === "number" ? v : 0;
  } catch {
    try {
      const snap = await getDoc(doc(db, AYAR_COL, AYAR_DOC));
      const v = snap.data()?.["aidatTutar"];
      return typeof v === "number" ? v : 0;
    } catch {
      return 0;
    }
  }
}

// ---- Paylaşımlı ayarlar dokümanı aboneliği ----
// Aidat tutarı, grup listesi ve hoca e-postaları aynı dokümanda tutulduğu için
// hepsi tek bir Firestore dinleyicisi üzerinden beslenir.
type AyarVeri = Record<string, unknown> | undefined;
let ayarSon: AyarVeri;
let ayarSonVar = false;
const ayarAbone = new Set<(v: AyarVeri) => void>();
let ayarUnsub: (() => void) | null = null;

function ayarlariDinle(cb: (v: AyarVeri) => void) {
  ayarAbone.add(cb);
  if (ayarSonVar) cb(ayarSon);
  if (!ayarUnsub) {
    ayarUnsub = onSnapshot(doc(db, AYAR_COL, AYAR_DOC), (snap) => {
      ayarSon = snap.data() as AyarVeri;
      ayarSonVar = true;
      ayarAbone.forEach((f) => f(ayarSon));
    });
  }
  return () => {
    ayarAbone.delete(cb);
  };
}

export function aidatTutariniDinle(cb: (tutar: number) => void) {
  const yerel = cacheOku<number>(CACHE.aidatTutar);
  if (!ayarSonVar && typeof yerel === "number") cb(yerel);
  return ayarlariDinle((v) => {
    const t = typeof v?.["aidatTutar"] === "number" ? (v["aidatTutar"] as number) : 0;
    cacheYaz(CACHE.aidatTutar, t);
    cb(t);
  });
}

export async function aidatTutariKaydet(tutar: number) {
  await setDoc(doc(db, AYAR_COL, AYAR_DOC), { aidatTutar: tutar }, { merge: true });
}

export async function aidatOdemeAyarla(t: Talebe, ayKey: string, odendi: boolean) {
  const harita = { ...(t.aidat ?? {}), [ayKey]: odendi };
  await talebeGuncelle(t.id, { aidat: harita });
}

// ---- Hoca e-postaları ve aidat hatırlatma kaydı ----

function hocaMailCoz(ham0: AyarVeri): HocaMailAyar {
  const v = (ham0 ?? {}) as Record<string, unknown>;
  const ham = Array.isArray(v["ekstraHocalar"]) ? (v["ekstraHocalar"] as unknown[]) : [];
  return {
    mailler:
      v["hocaMailler"] && typeof v["hocaMailler"] === "object"
        ? (v["hocaMailler"] as Record<string, string>)
        : {},
    gonderilen:
      v["aidatMailGonderim"] && typeof v["aidatMailGonderim"] === "object"
        ? (v["aidatMailGonderim"] as Record<string, string[]>)
        : {},
    ekstraHocalar: ham
      .filter((h: unknown): h is Partial<EkstraHoca> => !!h && typeof h === "object")
      .map((h) => ({
        id: typeof h.id === "string" ? h.id : String(Math.random()),
        ad: typeof h.ad === "string" ? h.ad : "",
        eposta: typeof h.eposta === "string" ? h.eposta : "",
        grup: typeof h.grup === "string" && h.grup ? h.grup : undefined,
      }))
      .filter((h) => h.ad || h.eposta),
  };
}

export function hocaMailAyarDinle(cb: (a: HocaMailAyar) => void) {
  const yerel = cacheOku<HocaMailAyar>(CACHE.hocaMail);
  if (!ayarSonVar && yerel) cb(yerel);
  return ayarlariDinle((v) => {
    const ayar = hocaMailCoz(v);
    cacheYaz(CACHE.hocaMail, ayar);
    cb(ayar);
  });
}

export async function ekstraHocalariKaydet(hocalar: EkstraHoca[]) {
  await setDoc(doc(db, AYAR_COL, AYAR_DOC), { ekstraHocalar: hocalar }, { merge: true });
}

export async function hocaMailleriKaydet(mailler: Record<string, string>) {
  await setDoc(doc(db, AYAR_COL, AYAR_DOC), { hocaMailler: mailler }, { merge: true });
}

export async function aidatMailGonderimIsaretle(
  ayKey: string,
  grupId: string,
  mevcut: Record<string, string[]>,
) {
  const liste = Array.from(new Set([...(mevcut[ayKey] ?? []), grupId]));
  await setDoc(
    doc(db, AYAR_COL, AYAR_DOC),
    { aidatMailGonderim: { ...mevcut, [ayKey]: liste } },
    { merge: true },
  );
}

// ---- Grup adları ve mesul hocalar (düzenlenebilir) ----

function grupListeCoz(data: Record<string, unknown> | undefined): GrupBilgi[] {
  const liste = data?.["grupListe"];
  if (Array.isArray(liste)) {
    const temiz = liste
      .map((x) => x as { id?: unknown; ad?: unknown; hoca?: unknown })
      .filter((x) => typeof x.id === "string" && (x.id as string).trim())
      .map((x) => ({
        id: (x.id as string).trim(),
        ad: typeof x.ad === "string" ? x.ad : "",
        hoca: typeof x.hoca === "string" ? x.hoca : "",
      }));
    return temiz;
  }
  // Eski kayıt biçimi: grupBilgi objesi
  const v = data?.["grupBilgi"];
  return GRUPLAR.map((g) => {
    const o =
      v && typeof v === "object"
        ? (v as Record<string, { ad?: unknown; hoca?: unknown }>)[g.id]
        : undefined;
    return {
      id: g.id,
      ad: typeof o?.ad === "string" && o.ad.trim() ? o.ad.trim() : g.ad,
      hoca: typeof o?.hoca === "string" && o.hoca.trim() ? o.hoca.trim() : g.hoca,
    };
  });
}

export function gruplarCacheOku(): GrupBilgi[] | null {
  const yerel = cacheOku<GrupBilgi[]>(CACHE.gruplar);
  return yerel && yerel.length > 0 ? yerel : null;
}

export function gruplariDinle(cb: (g: GrupBilgi[]) => void) {
  const yerel = gruplarCacheOku();
  if (!ayarSonVar && yerel) cb(yerel);
  return ayarlariDinle((v) => {
    const liste = grupListeCoz(v as Record<string, unknown> | undefined);
    if (liste.length > 0) cacheYaz(CACHE.gruplar, liste);
    cb(liste);
  });
}

export function yeniGrupId() {
  return `grup_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function gruplariKaydet(liste: GrupBilgi[]) {
  await setDoc(
    doc(db, AYAR_COL, AYAR_DOC),
    {
      grupListe: liste.map((g) => ({
        id: g.id,
        ad: g.ad.trim(),
        hoca: g.hoca.trim(),
      })),
    },
    { merge: true },
  );
}
