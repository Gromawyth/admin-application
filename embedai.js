"use strict";

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================================================
   KONFIG
========================================================= */

const CONFIG = {
  AI_MODEL: process.env.OPENAI_MODEL || "gpt-5-mini",

  /*
    Ide teheted azokat a csatornákat, ahol működjön.
    Ha üres, akkor a kategóriák alapján nézi.
  */
  SUPPORT_CHANNEL_IDS: [
     "1492932668495499304"
  ],

  /*
    Ticket / ügyfélszolgálat kategória ID-k.
  */
  SUPPORT_CATEGORY_IDS: [
     "1492932624308506739"
  ],

  /*
    Ha az AI nem biztos a válaszban, ezt a role-t pingeli.
  */
  SUPPORT_ROLE_ID: "1403401954712883200",

  /*
    Staff szerepek. Ha staff ír, az AI nem szól bele.
  */
  STAFF_ROLE_IDS: [
     "1403401954712883200"
  ],

  /*
    Olyan csatornák / kategóriák, ahol ne figyeljen.
  */
  EXEMPT_CHANNEL_IDS: [],
  EXEMPT_CATEGORY_IDS: [],

  /*
    Opcionális: mennyi régi üzenetet vigyen kontextusnak.
  */
  MAX_CONTEXT_MESSAGES: 12,

  /*
    Ugyanabban a csatornában mennyi ideig ne pingelje újra a staffot.
  */
  ESCALATION_COOLDOWN_MS: 45_000,

  /*
    Köszönésre válaszoljon-e.
  */
  REPLY_TO_GREETINGS: true,

  /*
    Köszire ne válaszoljon.
  */
  IGNORE_THANKS: false,

  /*
    Minimum hossz, ami alatt sokszor inkább nem veszi valódi kérdésnek.
  */
  MIN_REAL_QUESTION_LENGTH: 6,

  /*
    Ha nincs API kulcs, legyen fallback.
  */
  ENABLE_FALLBACK: true,

  /*
    Szabályzat fájlok.
    A feltöltött txt fájlt is megpróbálja betölteni, ha a projektben ott van.
  */
  RULE_FILES: [
    "./Szerverszabályzat v2 (1).txt",
    "./serverRules.txt",
    "./szerverszabalyzat.txt",
    "./rules.txt",
  ],
};

/* =========================================================
   DISCORD SZABÁLYZAT
========================================================= */

const DISCORD_RULES_TEXT = `
Discord szabályzat:

1. Általános magatartás
- Tiszteld a többi játékost.
- Tilos a sértegetés, fenyegetés, zaklatás, rasszizmus vagy szexizmus.
- Kulturált kommunikáció elvárt minden csatornán.
- A veszekedés és provokáció szigorúan tiltott.

2. Spam és flood
- Tilos az indokolatlan emoji- vagy GIF-spamelés.
- Ugyanazon üzenet ismételt küldése nem megengedett.

3. Név és profil
- A név nem lehet sértő, obszcén vagy megtévesztő.
- A profilkép nem tartalmazhat NSFW vagy erőszakos tartalmat.

4. Csatornák használata
- Minden csatornát rendeltetésszerűen használj.
- A ticket rendszert csak valós problémák esetén vedd igénybe.

5. Hirdetés és reklám
- Más szerverek, oldalak és Discord linkek reklámozása tilos.
- Ez DM-re is vonatkozik.

6. Hangcsatornák
- Zajkeltés, soundboard túlzásba vitele tilos.
- Ne zavard a többi játékos nyugalmát.

7. NSFW tartalom
- NSFW tartalom megosztása szigorúan tilos.

Büntetések:
- Figyelmeztetés, mute, kick vagy ban a súlyosságtól függően.
`;

/* =========================================================
   ÁLLAPOT
========================================================= */

let listenersRegistered = false;
const channelState = new Map();

/* =========================================================
   ALAP SEGÉDEK
========================================================= */

function now() {
  return Date.now();
}

function cleanText(text, max = 1800) {
  const safe = String(text || "").replace(/\s+/g, " ").trim();
  if (!safe) return "";
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

function lower(text) {
  return cleanText(text).toLowerCase();
}

function truncate(text, max = 1800) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function getState(channelId) {
  if (!channelState.has(channelId)) {
    channelState.set(channelId, {
      recentMessages: [],
      lastEscalationAt: 0,
      lastGreetingAtByUser: new Map(),
    });
  }
  return channelState.get(channelId);
}

function pushRecentMessage(channelId, role, text) {
  const state = getState(channelId);
  state.recentMessages.push({
    role,
    text: truncate(cleanText(text), 1000),
    at: new Date().toISOString(),
  });

  if (state.recentMessages.length > CONFIG.MAX_CONTEXT_MESSAGES) {
    state.recentMessages.shift();
  }
}

function isSupportChannel(channel) {
  if (!channel) return false;

  if (CONFIG.EXEMPT_CHANNEL_IDS.includes(channel.id)) return false;
  if (channel.parentId && CONFIG.EXEMPT_CATEGORY_IDS.includes(channel.parentId)) return false;

  if (CONFIG.SUPPORT_CHANNEL_IDS.length && CONFIG.SUPPORT_CHANNEL_IDS.includes(channel.id)) {
    return true;
  }

  if (
    CONFIG.SUPPORT_CATEGORY_IDS.length &&
    channel.parentId &&
    CONFIG.SUPPORT_CATEGORY_IDS.includes(channel.parentId)
  ) {
    return true;
  }

  return false;
}

function hasStaffRole(member) {
  if (!member?.roles?.cache) return false;
  if (!CONFIG.STAFF_ROLE_IDS.length) return false;
  return CONFIG.STAFF_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function looksLikeGreeting(text) {
  const t = lower(text);
  return /^(szia+|sziasztok|hello|helló|helo|hali|szevasz|jó reggelt|jo reggelt|jó estét|jo estet|jónapot|yo|hey)\s*!*$/i.test(t);
}

function looksLikeThanks(text) {
  const t = lower(text);
  return /^(köszi|koszi|köszönöm|koszonom|thx|thanks|nagyon köszi|oke koszi|oké köszi)\s*!*$/i.test(t);
}

function looksLikeBye(text) {
  const t = lower(text);
  return /^(viszlát|viszlat|bye|csá|csa|na csá|na csa)\s*!*$/i.test(t);
}

function looksLikeNonsense(text) {
  const t = lower(text);

  if (!t) return true;

  const exact = new Set([
    "xd", "xddd", "lol", "teszt", "test", "alma", "aaa", "aaaa", "asd", "ok",
    "oke", "oké", "aha", "ja", "hm", "bruh", "na", "hehe"
  ]);

  if (exact.has(t)) return true;
  if (t.length < 3) return true;
  if (/^(asd+|qwe+|123+|aaa+|bbb+|hehe+|xd+)$/i.test(t)) return true;

  return false;
}

function looksAbusive(text) {
  const t = lower(text);
  return /(kurva|fasz|geci|szar|retard|idióta|idiota|hülye|hulye|bazd|anyád|anyad|szopj|buzi|dögölj|dogolj)/i.test(t);
}

function looksLikeRealQuestion(text) {
  const raw = cleanText(text);
  const t = lower(text);

  if (!raw) return false;
  if (raw.length < CONFIG.MIN_REAL_QUESTION_LENGTH) return false;
  if (looksLikeNonsense(raw)) return false;

  if (raw.includes("?")) return true;

  const starts = [
    "mi ", "mit ", "hogyan", "hogy ", "mikor", "mennyi", "miért", "miert",
    "lehet ", "szabad ", "tudok ", "tudom ", "segíts", "segits",
    "hol ", "jár-e", "van-e", "tilos", "szabály", "szabaly"
  ];

  if (starts.some((s) => t.startsWith(s))) return true;

  const keywords = [
    "ticket", "szabály", "szabaly", "ban", "mute", "warn", "reklám", "reklam",
    "discord link", "nsfw", "hangcsatorna", "profilkép", "profilkep", "név", "nev",
    "admin", "report", "hirdetés", "hirdetes", "farm", "rablás", "rablas", "mg",
    "dm", "rk", "fearrp", "character kill", "ck", "metagaming", "powergaming",
    "frakció", "frakcio", "dark web", "fegyver", "helikopter", "pit", "bodycam",
    "cctv", "pk", "rendszám", "rendszam"
  ];

  return keywords.some((k) => t.includes(k));
}

function getGreetingReply() {
  const replies = [
    "Szia, miben tudok segíteni?",
    "Szia. Írd le röviden, mi a kérdés.",
    "Szia, mondd nyugodtan miben kell segítség.",
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

function loadRulesText() {
  for (const filePath of CONFIG.RULE_FILES) {
    try {
      const abs = path.resolve(process.cwd(), filePath);
      if (fs.existsSync(abs)) {
        return fs.readFileSync(abs, "utf8");
      }
    } catch {
      // ignore
    }
  }
  return "";
}

function buildKnowledgeBase() {
  const detailedRules = loadRulesText();

  return [
    "DISCORD SZABÁLYZAT:",
    DISCORD_RULES_TEXT,
    "",
    detailedRules
      ? `RÉSZLETES SZERVER SZABÁLYZAT:\n${detailedRules}`
      : "RÉSZLETES SZERVER SZABÁLYZAT: nincs külön fájl betöltve.",
    "",
    "VÁLASZADÁSI ELVEK:",
    "- Csak arra válaszolj biztosan, amit a szabályzat tényleg lefed.",
    "- Ha nem egyértelmű, ne találj ki semmit.",
    "- Ha egyedi staff döntés kell, inkább add át embernek.",
    "- Röviden, természetesen, emberi stílusban írj.",
    "- Ne legyél modoros és ne írj fölösleges köröket.",
  ].join("\n");
}

/* =========================================================
   OPENAI DÖNTÉS
========================================================= */

function getJsonFromText(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "{}";
  return raw.slice(start, end + 1);
}

function normalizeAiDecision(parsed) {
  const action = ["answer", "escalate", "ignore", "greet"].includes(parsed?.action)
    ? parsed.action
    : "ignore";

  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed?.confidence || 0))));

  return {
    action,
    confidence,
    reply: cleanText(parsed?.reply || "", 1800),
    reason: cleanText(parsed?.reason || "", 300),
    should_ping_role: Boolean(parsed?.should_ping_role),
  };
}

async function classifyAndAnswerWithAI({ messageText, knowledgeBase, recentMessages }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const system = `
Te egy Discordos ügyfélszolgálatos AI vagy.

Feladat:
- normálisan tudsz beszélni
- ha a user köszön, emberien köszönj vissza
- ha a user valódi kérdést tesz fel, válaszolj röviden
- ha a user hülyeséget, trollkodást, sértegetést vagy üres spamet ír, ne kezeld valódi kérdésként
- ne fecsegj
- ne legyél diplomatikus
- ne találj ki semmit
- csak a megadott szabályzatból és biztos tudásból válaszolj
- ha a kérdés egyedi staff döntést igényel vagy nem vagy biztos, akkor eszkalálj

Kimenet: csak JSON

Formátum:
{
  "action": "answer|escalate|ignore|greet",
  "confidence": 0,
  "reply": "rövid magyar szöveg",
  "reason": "rövid belső ok",
  "should_ping_role": true
}

Szabályok:
- "szia" és hasonlók => greet
- köszönetre általában ignore
- troll / sértő / értelmetlen / spam jelleg => ignore
- szabályból egyértelmű kérdés => answer
- bizonytalan vagy staff döntéses kérdés => escalate
- a válasz legyen rövid, emberi, nem modoros
`;

  const inputPayload = {
    user_message: messageText,
    recent_messages: recentMessages.slice(-8),
    knowledge_base: knowledgeBase,
  };

  const response = await openai.responses.create({
    model: CONFIG.AI_MODEL,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(inputPayload) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "support_ai_decision",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string" },
            confidence: { type: "number" },
            reply: { type: "string" },
            reason: { type: "string" },
            should_ping_role: { type: "boolean" },
          },
          required: ["action", "confidence", "reply", "reason", "should_ping_role"],
        },
      },
    },
  });

  const outputText = response.output_text || "{}";
  const parsed = JSON.parse(getJsonFromText(outputText));
  return normalizeAiDecision(parsed);
}

/* =========================================================
   FALLBACK DÖNTÉS
========================================================= */

function fallbackDecision(messageText) {
  const text = cleanText(messageText);

  if (looksLikeGreeting(text)) {
    return {
      action: "greet",
      confidence: 95,
      reply: getGreetingReply(),
      reason: "simple_greeting",
      should_ping_role: false,
    };
  }

  if (looksLikeThanks(text) || looksLikeBye(text)) {
    return {
      action: "ignore",
      confidence: 95,
      reply: "",
      reason: "short_non_support_message",
      should_ping_role: false,
    };
  }

  if (looksAbusive(text)) {
    return {
      action: "ignore",
      confidence: 96,
      reply: "",
      reason: "abusive_or_troll",
      should_ping_role: false,
    };
  }

  if (looksLikeNonsense(text)) {
    return {
      action: "ignore",
      confidence: 94,
      reply: "",
      reason: "nonsense",
      should_ping_role: false,
    };
  }

  if (looksLikeRealQuestion(text)) {
    return {
      action: "escalate",
      confidence: 55,
      reply: "Erre inkább ránéz valaki a csapatból.",
      reason: "real_question_but_no_ai_answer",
      should_ping_role: true,
    };
  }

  return {
    action: "ignore",
    confidence: 70,
    reply: "",
    reason: "not_clear_enough",
    should_ping_role: false,
  };
}

/* =========================================================
   KÜLDÉS
========================================================= */

function shouldReplyToGreeting(channelId, userId) {
  const state = getState(channelId);
  const last = state.lastGreetingAtByUser.get(userId) || 0;

  if (now() - last < 45_000) return false;

  state.lastGreetingAtByUser.set(userId, now());
  return true;
}

async function sendEscalationReply(message, baseReply, shouldPingRole) {
  const state = getState(message.channel.id);

  if (now() - state.lastEscalationAt < CONFIG.ESCALATION_COOLDOWN_MS) {
    if (baseReply) {
      await message.reply({
        content: truncate(baseReply, 1800),
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }
    return;
  }

  state.lastEscalationAt = now();

  const hasRole =
    CONFIG.SUPPORT_ROLE_ID &&
    CONFIG.SUPPORT_ROLE_ID !== "IDE_A_SUPPORT_ROLE_ID";

  let content = baseReply || "Erre nézzen rá valaki a csapatból.";

  if (shouldPingRole && hasRole) {
    content = `<@&${CONFIG.SUPPORT_ROLE_ID}> ${content}`;
  }

  await message.reply({
    content: truncate(content, 1800),
    allowedMentions: {
      parse: [],
      roles: shouldPingRole && hasRole ? [CONFIG.SUPPORT_ROLE_ID] : [],
    },
  }).catch(() => null);
}

async function sendNormalReply(message, content) {
  if (!content) return;

  await message.reply({
    content: truncate(content, 1800),
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

/* =========================================================
   FŐ KEZELÉS
========================================================= */

async function handleSupportMessage(client, message) {
  if (!isSupportChannel(message.channel)) return;
  if (message.author.bot) return;
  if (!message.guild) return;

  const text = cleanText(message.content || "");
  const attachmentsCount = message.attachments?.size || 0;

  pushRecentMessage(message.channel.id, "user", text || `[csatolmány: ${attachmentsCount}]`);

  if (hasStaffRole(message.member)) {
    return;
  }

  if (!text && !attachmentsCount) {
    return;
  }

  let decision = null;

  try {
    const knowledgeBase = buildKnowledgeBase();

    if (process.env.OPENAI_API_KEY) {
      decision = await classifyAndAnswerWithAI({
        messageText: text,
        knowledgeBase,
        recentMessages: getState(message.channel.id).recentMessages,
      });
    }
  } catch (error) {
    console.error("[SUPPORT AI] OpenAI hiba:", error?.message || error);
    decision = null;
  }

  if (!decision && CONFIG.ENABLE_FALLBACK) {
    decision = fallbackDecision(text);
  }

  if (!decision) return;

  pushRecentMessage(message.channel.id, "assistant_decision", JSON.stringify(decision));

  switch (decision.action) {
    case "ignore": {
      return;
    }

    case "greet": {
      if (!CONFIG.REPLY_TO_GREETINGS) return;
      if (!shouldReplyToGreeting(message.channel.id, message.author.id)) return;
      await sendNormalReply(message, decision.reply || getGreetingReply());
      return;
    }

    case "answer": {
      if (!decision.reply) return;
      await sendNormalReply(message, decision.reply);
      return;
    }

    case "escalate": {
      await sendEscalationReply(
        message,
        decision.reply || "Erre inkább ránéz valaki a csapatból.",
        decision.should_ping_role
      );
      return;
    }

    default:
      return;
  }
}

/* =========================================================
   REGISZTRÁLÁS
========================================================= */

function registerSupportAI(client) {
  if (listenersRegistered) return;
  listenersRegistered = true;

  client.on("messageCreate", async (message) => {
    await handleSupportMessage(client, message);
  });

  client.once("ready", () => {
    console.log("✅ [SUPPORT AI] Ügyfélszolgálatos AI aktív.");
  });
}

module.exports = {
  registerSupportAI,
};