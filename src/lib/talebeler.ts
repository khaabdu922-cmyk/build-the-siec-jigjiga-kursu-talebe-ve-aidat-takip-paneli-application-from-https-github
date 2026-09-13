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

// Firestore/Firebase SDK'sı ağırdır; ilk boyamayı geciktirmemesi için
// yalnızca gerektiğinde (dinamik import) yüklenir.
type FsModul = typeof import("./talebeler.fs");
let fsSoz: Promise<FsModul> | null = null;
function fs(): Promise<FsModul> {
  if (!fsSoz) fsSoz = import("./talebeler.fs");
  return fsSoz;
}

// İlk render'dan sonra, tarayıcı boştayken arka planda yükle.
function bosaldiginda(f: () => void) {
  if (typeof window === "undefined") return f();
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback;
  if (ric) ric(f);
  else setTimeout(f, 1);
}

// ---- Paylaşımlı önbellek + tekil dinleyici ----
const TALEBE_CACHE_KEY = "talebe-takip-cache-v1";

let talebeCache: Talebe[] | null = null;
let talebeUnsub: (() => void) | null = null;
let talebeDinleyiciKuruldu = false;
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
  } catch {
    // yoksay
  }
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

export function talebeleriDinle(cb: (t: Talebe[]) => void, onError?: (e: Error) => void) {
  talebeAboneler.add(cb);
  if (onError) talebeHataAboneler.add(onError);

  // Stale-while-revalidate: önce önbellek, sonra canlı veri.
  const onbellek = talebeleriOnbellektenOku();
  if (onbellek) cb(onbellek);

  // Dinleyici bir kez kurulur ve açık kalır: diğer cihazlardaki
  // değişiklikler anında (saniyeler içinde) buraya düşer.
  if (!talebeDinleyiciKuruldu) {
    talebeDinleyiciKuruldu = true;
    bosaldiginda(() => {
      void fs().then((m) => {
        talebeUnsub = m.dinle(
          (liste) => talebeCacheYaz(liste),
          (err) => talebeHataAboneler.forEach((f) => f(err)),
        );
      });
    });
  }

  return () => {
    talebeAboneler.delete(cb);
    if (onError) talebeHataAboneler.delete(onError);
  };
}

export function talebeDinleyiciDurdur() {
  talebeUnsub?.();
  talebeUnsub = null;
  talebeDinleyiciKuruldu = false;
}

// Sunucu yanıtı beklenmeden yerel listeyi/önbelleği günceller.
function iyimserUygula(degistir: (liste: Talebe[]) => Talebe[], kalici = false) {
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
  return (await fs()).ekle(t);
}

export async function talebeGuncelle(id: string, patch: Partial<Omit<Talebe, "id">>) {
  iyimserUygula((l) => l.map((t) => (t.id === id ? { ...t, ...patch } : t)), true);
  await (await fs()).guncelle(id, patch);
}

export async function talebeSil(id: string) {
  iyimserUygula((l) => l.filter((t) => t.id !== id), true);
  await (await fs()).sil(id);
}

export async function topluHedefGuncelle(ids: string[], hedef: number) {
  iyimserUygula(
    (l) => l.map((t) => (ids.includes(t.id) ? { ...t, hedefHaftalik: hedef } : t)),
    true,
  );
  await (await fs()).topluHedef(ids, hedef);
}

// ---- Aidat (aylık ödeme) ----

const AIDAT_CACHE_KEY = "aidat-tutar-cache-v1";

let aidatTutarCache: number | null = null;
let aidatDinleyiciKuruldu = false;
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
    } catch {
      // yoksay
    }
  }
}

export async function aidatTutariniOku(): Promise<number> {
  // Dinleyici açıksa ya da daha önce okunduysa ağ sorgusu yapılmaz.
  const onbellek = aidatOnbellek();
  if (onbellek !== null) return onbellek;
  try {
    const tutar = await (await fs()).aidatOku();
    aidatCacheYaz(tutar);
    return tutar;
  } catch {
    return 0;
  }
}

export function aidatTutariniDinle(cb: (tutar: number) => void) {
  aidatAboneler.add(cb);
  const onbellek = aidatOnbellek();
  if (onbellek !== null) cb(onbellek);

  // Dinleyici açık kalır: tutar başka bir cihazda değişirse anında yansır.
  if (!aidatDinleyiciKuruldu) {
    aidatDinleyiciKuruldu = true;
    bosaldiginda(() => {
      void fs().then((m) =>
        m.aidatDinle((tutar) => {
          aidatCacheYaz(tutar);
          aidatAboneler.forEach((f) => f(tutar));
        }),
      );
    });
  }

  return () => {
    aidatAboneler.delete(cb);
  };
}

export async function aidatTutariKaydet(tutar: number) {
  // İyimser güncelleme: ekranda anında görünür.
  aidatCacheYaz(tutar);
  aidatAboneler.forEach((f) => f(tutar));
  await (await fs()).aidatKaydet(tutar);
}

export async function aidatOdemeAyarla(t: Talebe, ayKey: string, odendi: boolean) {
  const harita = { ...(t.aidat ?? {}), [ayKey]: odendi };
  await talebeGuncelle(t.id, { aidat: harita });
}
