import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

export type SerbestMailGirdi = {
  eposta: string;
  konu: string;
  metin: string;
};

function gecerliEposta(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

const b64 = (s: string) =>
  btoa(
    Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(
      "",
    ),
  );

const header = (v: string) =>
  /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`;

function rawMail(to: string, subject: string, body: string) {
  const mesaj = [
    `To: ${to}`,
    `Subject: ${header(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");
  return b64(mesaj).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const serbestMailGonder = createServerFn({ method: "POST" })
  .inputValidator((input: SerbestMailGirdi) => {
    const eposta = String(input?.eposta ?? "").trim();
    const konu = String(input?.konu ?? "")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 200)
      .trim();
    const metin = String(input?.metin ?? "").slice(0, 20000);
    if (!gecerliEposta(eposta)) {
      throw new Error("Geçerli bir e-posta adresi gerekli.");
    }
    if (!konu) throw new Error("Konu boş olamaz.");
    if (!metin.trim()) throw new Error("Mesaj boş olamaz.");
    return { eposta, konu, metin };
  })
  .handler(async ({ data }) => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const gmailKey = process.env["GOOGLE_MAIL_API_KEY"];
    if (!lovableKey || !gmailKey) {
      throw new Error("Gmail bağlantısı bulunamadı.");
    }

    const res = await fetch(`${GATEWAY_URL}/users/me/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gmailKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: rawMail(data.eposta, data.konu, data.metin),
      }),
    });

    if (!res.ok) {
      const hata = await res.text();
      console.error(`Gmail gönderim hatası [${res.status}]: ${hata}`);
      throw new Error(`E-posta gönderilemedi [${res.status}]: ${hata}`);
    }

    return { ok: true as const };
  });
