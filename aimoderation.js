"use strict";

const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  MessageFlags,
} = require("discord.js");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CONFIG = {
  SERVER_NAME: "internalGaming",

  // =========================
  // IDE ÍRD A SAJÁT ID-KAT
  // =========================
  MOD_LOG_CHANNEL_ID: "IDE_IRD_A_MOD_LOG_CSATORNA_IDT",

  STAFF_ROLE_IDS: [
    "IDE_IRD_A_STAFF_ROLE_IDT",
    "IDE_IRD_A_MAGASABB_STAFF_ROLE_IDT",
  ],

  EXEMPT_ROLE_IDS: [],
  EXEMPT_CHANNEL_IDS: [],
  EXEMPT_CATEGORY_IDS: [],

  ALLOW_DELETE: true,
  ALLOW_TIMEOUT: true,
  ALLOW_KICK: true,
  ALLOW_BAN: true,

  AI_MODEL: "gpt-5-mini",

  MAX_CONTEXT_MESSAGES: 8,
  MAX_PROFILE_INCIDENTS: 180,
  MAX_LAST_MESSAGES_PER_USER: 20,
  MAX_PREVIOUS_PROBLEM_MESSAGES: 5,

  // Kockázat %
  WATCH_THRESHOLD: 30,
  HIGH_RISK_THRESHOLD: 50,
  KICK_NEAR_THRESHOLD: 72,
  BAN_NEAR_THRESHOLD: 88,
  AUTO_BAN_READY_THRESHOLD: 100,

  // AI küszöbök - bátrabb
  MIN_AI_CONFIDENCE_FOR_TIMEOUT: 45,
  MIN_AI_CONFIDENCE_FOR_KICK: 58,
  MIN_AI_CONFIDENCE_FOR_BAN: 72,

  TIMEOUT_MINUTES_LOW: 15,
  TIMEOUT_MINUTES_MEDIUM: 60,
  TIMEOUT_MINUTES_HIGH: 360,
  TIMEOUT_MINUTES_CRITICAL: 1440,

  FLOOD_WINDOW_MS: 18_000,
  FLOOD_MESSAGE_COUNT: 5,
  DUPLICATE_WINDOW_MS: 45_000,
  DUPLICATE_MIN_COUNT: 3,
  MASS_MENTION_COUNT: 4,
  CAPS_MIN_LENGTH: 16,
  CAPS_RATIO_THRESHOLD: 0.72,
  EMOJI_SPAM_THRESHOLD: 10,
  REPEAT_CHAR_THRESHOLD: 10,

  MIN_INCIDENT_SCORE_FOR_LOG: 20,
  USER_CASE_COOLDOWN_MS: 15 * 1000,

  DECAY_DAYS_STRONG: 7,
  DECAY_DAYS_MEDIUM: 30,
  DECAY_DAYS_LIGHT: 90,

  DATA_FILE: path.join(__dirname, "aimoderation-data.json"),

  RULES: [
    "Tilos más felhasználók piszkálása, zaklatása, szidása, fenyegetése, lejáratása, abuzálása, kifigurázása.",
    "Tilos a szerver, adminok, fejlesztők, vezetőség obszcén, degradáló, nem szalonképes szidalmazása.",
    "Tilos mások nem publikus adatainak kiadása és felhasználása.",
    "Tilos politikai, etnikai, pornográf, NSFW, gusztustalan vagy kétértelműen tiltott tartalom.",
    "Tilos más szerverek hirdetése / szidása, linkkel, névvel, avatarban, képpel vagy más formában.",
    "Tilos floodolni, spamelni, indokolatlanul tagelni.",
    "Tilos adminnak / vezetőségnek normális indok nélkül DM-et küldeni.",
    "Tilos az OOC kereskedelem és már annak szándéka is. Ez örök kitiltást vonhat maga után.",
    "Tilos sértő, obszcén, megtévesztő név vagy staff/vezetőségi név utánzása.",
    "Hangcsatornában tilos a zavaró hangkeltés, soundboard túlhasználata, DC MG és a staff előli kilépés ügyintézés közben.",
  ],

  BLOCKED_NAME_PATTERNS: [
    /admin/i,
    /moder[aá]tor/i,
    /owner/i,
    /tulaj/i,
    /internalgaming/i,
  ],
};

function getDefaultStore() {
  return {
    users: {},
    bannedUsers: {},
    feedback: {
      reviewOk: {},
      mistake: {},
    },
    caseMessages: {}, // userId -> messageId
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(CONFIG.DATA_FILE)) {
      fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(getDefaultStore(), null, 2), "utf8");
      return getDefaultStore();
    }

    const raw = fs.readFileSync(CONFIG.DATA_FILE, "utf8");
    if (!raw.trim()) return getDefaultStore();

    const parsed = JSON.parse(raw);
    return {
      users: parsed.users || {},
      bannedUsers: parsed.bannedUsers || {},
      feedback: parsed.feedback || { reviewOk: {}, mistake: {} },
      caseMessages: parsed.caseMessages || {},
    };
  } catch (error) {
    console.error("[AIMOD] loadStore hiba:", error);
    return getDefaultStore();
  }
}

let store = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    console.error("[AIMOD] saveStore hiba:", error);
  }
}

function now() {
  return Date.now();
}

function cleanText(text, max = 1800) {
  const safe = String(text || "").replace(/\s+/g, " ").trim();
  if (!safe) return "";
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

function trimField(text, max = 1024) {
  return cleanText(text, max) || "-";
}

function safeMentionUser(userId) {
  return userId ? `<@${userId}>` : "Ismeretlen";
}

function isStaff(member) {
  if (!member?.roles?.cache) return false;
  return CONFIG.STAFF_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function hasExemptRole(member) {
  if (!member?.roles?.cache) return false;
  return CONFIG.EXEMPT_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

function isExemptChannel(channel) {
  if (!channel) return true;
  if (CONFIG.EXEMPT_CHANNEL_IDS.includes(channel.id)) return true;
  if (channel.parentId && CONFIG.EXEMPT_CATEGORY_IDS.includes(channel.parentId)) return true;
  return false;
}

function shouldIgnoreMessage(message) {
  if (!message?.guild) return true;
  if (message.author?.bot) return true;
  if (message.webhookId) return true;
  if (!message.member) return true;
  if (isStaff(message.member)) return true;
  if (hasExemptRole(message.member)) return true;
  if (isExemptChannel(message.channel)) return true;
  return false;
}

function colorBySeverity(severity) {
  switch (severity) {
    case "kritikus": return 0xaa0000;
    case "magas": return 0xd63c3c;
    case "közepes": return 0xff8a00;
    case "enyhe": return 0xf0c419;
    default: return 0x2f3136;
  }
}

function emojiBySeverity(severity) {
  switch (severity) {
    case "kritikus": return "🛑";
    case "magas": return "🚨";
    case "közepes": return "⚠️";
    case "enyhe": return "🟡";
    default: return "ℹ️";
  }
}

function categoryToHu(category) {
  const map = {
    harassment: "Zaklatás / sértegetés",
    threat: "Fenyegetés",
    staff_abuse: "Staff / szerver szidalmazása",
    doxxing: "Privát adat / doxxolás",
    nsfw: "NSFW / obszcén tartalom",
    ad_server: "Más szerver reklámja",
    spam: "Spam",
    flood: "Flood",
    ooc_trade: "OOC kereskedelem",
    scam: "Átverés / scam",
    ban_evasion: "Ban evasion / visszatérés gyanú",
    politics_sensitive: "Tiltott érzékeny tartalom",
    clean: "Nem problémás",
    other: "Egyéb szabálysértés",
    name_profile: "Tiltott név / profil",
  };
  return map[category] || "Egyéb szabálysértés";
}

function getLogChannel(client) {
  if (!CONFIG.MOD_LOG_CHANNEL_ID || CONFIG.MOD_LOG_CHANNEL_ID.startsWith("IDE_")) return null;
  return client.channels.cache.get(CONFIG.MOD_LOG_CHANNEL_ID) || null;
}

function getUserProfile(userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      incidents: [],
      recentMessages: [],
      lastCaseAt: 0,
      activeCase: {
        lastAction: "Nincs",
        lastReason: "",
        lastCategory: "",
        lastSeverity: "",
        lastAnalysis: "",
        lastPatternSummary: "",
        lastMessageContent: "",
        lastUpdatedAt: 0,
        currentStatus: "Megfigyelés",
      },
      totals: {
        warnings: 0,
        deletions: 0,
        timeouts: 0,
        kicks: 0,
        bans: 0,
        unbans: 0,
      },
    };
  }
  return store.users[userId];
}

function pushRecentMessage(userId, message) {
  const profile = getUserProfile(userId);
  profile.recentMessages.push({
    id: message.id,
    content: cleanText(message.content || "", 500),
    createdAt: message.createdTimestamp || Date.now(),
    channelId: message.channelId,
  });

  if (profile.recentMessages.length > CONFIG.MAX_LAST_MESSAGES_PER_USER) {
    profile.recentMessages = profile.recentMessages.slice(-CONFIG.MAX_LAST_MESSAGES_PER_USER);
  }
}

function addIncident(userId, incident) {
  const profile = getUserProfile(userId);
  profile.incidents.push(incident);

  if (profile.incidents.length > CONFIG.MAX_PROFILE_INCIDENTS) {
    profile.incidents = profile.incidents.slice(-CONFIG.MAX_PROFILE_INCIDENTS);
  }
}

function getIncidentDecayWeight(ageMs) {
  const d7 = CONFIG.DECAY_DAYS_STRONG * 24 * 60 * 60 * 1000;
  const d30 = CONFIG.DECAY_DAYS_MEDIUM * 24 * 60 * 60 * 1000;
  const d90 = CONFIG.DECAY_DAYS_LIGHT * 24 * 60 * 60 * 1000;

  if (ageMs <= d7) return 1;
  if (ageMs <= d30) return 0.6;
  if (ageMs <= d90) return 0.25;
  return 0.06;
}

function getRawRiskValue(profile) {
  const current = now();
  let risk = 0;

  for (const inc of profile.incidents || []) {
    const age = current - (inc.createdAt || current);
    const weight = getIncidentDecayWeight(age);
    risk += Number(inc.points || 0) * weight;
  }

  risk += (profile.totals?.timeouts || 0) * 12;
  risk += (profile.totals?.kicks || 0) * 22;
  risk += (profile.totals?.bans || 0) * 35;

  return risk;
}

function getRiskPercent(profile) {
  const raw = getRawRiskValue(profile);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function getRecentIncidentCounts(profile) {
  const current = now();
  let last7d = 0;
  let last30d = 0;
  let serious7d = 0;
  let serious30d = 0;

  for (const inc of profile.incidents || []) {
    const age = current - (inc.createdAt || current);
    const severe = ["közepes", "magas", "kritikus"].includes(inc.severity);

    if (age <= 7 * 24 * 60 * 60 * 1000) {
      last7d++;
      if (severe) serious7d++;
    }

    if (age <= 30 * 24 * 60 * 60 * 1000) {
      last30d++;
      if (severe) serious30d++;
    }
  }

  return { last7d, last30d, serious7d, serious30d };
}

function actionToLabel(action) {
  switch (action) {
    case "ignore": return "Nincs automata lépés";
    case "warn": return "Figyelmeztetés";
    case "delete": return "Üzenet törlése";
    case "timeout": return "Timeout / mute";
    case "kick": return "Kick";
    case "ban": return "Ban";
    case "unban": return "Feloldás / unban";
    default: return "Nincs";
  }
}

function timeoutMsForSeverity(severity) {
  switch (severity) {
    case "kritikus": return CONFIG.TIMEOUT_MINUTES_CRITICAL * 60 * 1000;
    case "magas": return CONFIG.TIMEOUT_MINUTES_HIGH * 60 * 1000;
    case "közepes": return CONFIG.TIMEOUT_MINUTES_MEDIUM * 60 * 1000;
    default: return CONFIG.TIMEOUT_MINUTES_LOW * 60 * 1000;
  }
}

function canModerateTarget(member) {
  if (!member?.guild?.members?.me) return false;
  const me = member.guild.members.me;
  if (member.id === me.id) return false;
  if (member.user?.bot) return false;
  return me.roles.highest.position > member.roles.highest.position;
}

function buildRulesText() {
  return CONFIG.RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

const REGEX = {
  invite: /(discord\.gg\/|discord\.com\/invite\/)/i,
  oocTrade:
    /\b(ooc keresked[eé]s|ooc trade|érdekel valakit|elad[oó] ig vagyon|ig vagyon elad[oó]|item elad[oó]|account elad[oó]|accountot eladom|veszek accountot|irl|val[óo]s ?p[eé]nz|forint|ft\b|eur[oó]|paypal|revolut|utal(ok|ás)?|bankk[aá]rtya|nitro|steam gift|giftcard|p[eé]nz[ée]rt adom|p[eé]nz[ée]rt veszem|ig vagyonért|accountért|itemért)\b/i,
  doxxing:
    /\b(facebook|fb profil|insta|instagram|telefonsz[aá]m|lakc[ií]m|c[ií]m[e]?|szem[eé]lyi|anyja neve|ad[óo]sz[aá]m|taj|priv[aá]t k[eé]p|nem publikus k[eé]p|kirakom a k[eé]p[eé]t|kirakom a facebookj[aá]t)\b/i,
  threat:
    /\b(meg[oö]llek|megverlek|sz[eé]tszedlek|kiny[ií]rlak|elkaplak|megtal[áa]llak|megkereslek|kicsinállak)\b/i,
  harassment:
    /\b(kurva any[aá]d|any[aá]d|nyomor[eé]k|retkes|patk[aá]ny|geci|id[ií]óta|majom|szarh[aá]zi|semmirekell[oő]|csicska|hülye vagy|rohadj meg|dogolj meg|dögölj meg)\b/i,
  staffAbuse:
    /\b(admin|moder[aá]tor|vezet[oő]s[eé]g|staff|fejleszt[oő]|szerver|internalgaming)\b.{0,30}\b(szar|szarh[aá]zi|retkes|nyomor[eé]k|hullad[eé]k|boh[oó]c|geci|fos|szutyok|szenny)\b/i,
  adServer:
    /\b(discord\.gg\/|discord\.com\/invite\/|gyertek|gyere fel|jöjjön mindenki|jöjjetek|gyertek át|fel mindenki|másik szerver|jobb szerver|jobb mint ez|ne legyen ezen a szerveren|itt rossz|át ide|tesztgaming|gazdagrp|szerverre|serverre)\b/i,
  nsfw:
    /\b(porn[oó]|18\+|nsfw|meztelen|szexk[eé]p|nudes?|farkad|pin[aá]|szop[aá]s|basz[aá]s|kuki|punci)\b/i,
  politics:
    /\b(n[aá]ci|zsid[oó]|cig[aá]nyok|rom[aá]k|fidesz|tisza|orb[aá]n|migr[aá]nsok)\b/i,
  vpnBanEvade:
    /\b(vpn|proxy|újra visszaj[oö]ttem|alt account|m[aá]sik account|ban evasion|bannoltak de visszaj[oö]ttem)\b/i,
  scam:
    /\b(ingyen nitro|free nitro|steam aj[aá]nd[eé]k|gift link|próbáld ki ezt a linket|token|bejelentkezés itt|login here|free csgo skin)\b/i,
  mentionAbuse: /<@!?\d+>/g,
  emoji: /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}]/gu,
  repeatChars: /(.)\1{9,}/i,
};

function scanRules(message, recentSameUser = []) {
  const content = String(message.content || "");
  const lower = content.toLowerCase();

  const hits = [];
  let score = 0;

  if (!content.trim()) return { hits, score };

  if (REGEX.invite.test(content)) {
    hits.push({ key: "ad_server", points: 36, label: "Discord invite / reklám" });
    score += 36;
  }

  if (REGEX.oocTrade.test(content)) {
    hits.push({ key: "ooc_trade", points: 100, label: "OOC kereskedelem gyanú" });
    score += 100;
  }

  if (REGEX.doxxing.test(content)) {
    hits.push({ key: "doxxing", points: 80, label: "Privát adat / doxxing gyanú" });
    score += 80;
  }

  if (REGEX.threat.test(content)) {
    hits.push({ key: "threat", points: 68, label: "Fenyegetés gyanú" });
    score += 68;
  }

  if (REGEX.staffAbuse.test(content)) {
    hits.push({ key: "staff_abuse", points: 58, label: "Staff / szerver obszcén szidalmazása" });
    score += 58;
  }

  if (REGEX.harassment.test(content)) {
    hits.push({ key: "harassment", points: 40, label: "Célzott sértegetés / zaklatás gyanú" });
    score += 40;
  }

  if (REGEX.adServer.test(content)) {
    hits.push({ key: "ad_server", points: 62, label: "Más szerver reklám / uszítás" });
    score += 62;
  }

  if (REGEX.nsfw.test(content)) {
    hits.push({ key: "nsfw", points: 58, label: "NSFW / obszcén tartalom gyanú" });
    score += 58;
  }

  if (REGEX.politics.test(content)) {
    hits.push({ key: "politics_sensitive", points: 22, label: "Tiltott érzékeny tartalom" });
    score += 22;
  }

  if (REGEX.vpnBanEvade.test(content)) {
    hits.push({ key: "ban_evasion", points: 84, label: "VPN / ban evasion gyanú" });
    score += 84;
  }

  if (REGEX.scam.test(content)) {
    hits.push({ key: "scam", points: 95, label: "Scam / átverés gyanú" });
    score += 95;
  }

  const mentionCount = (content.match(REGEX.mentionAbuse) || []).length;
  if (mentionCount >= CONFIG.MASS_MENTION_COUNT) {
    hits.push({ key: "spam", points: 20, label: "Indokolatlan tömeges tagelés" });
    score += 20;
  }

  const emojiCount = (content.match(REGEX.emoji) || []).length;
  if (emojiCount >= CONFIG.EMOJI_SPAM_THRESHOLD) {
    hits.push({ key: "spam", points: 12, label: "Emoji / GIF spam gyanú" });
    score += 12;
  }

  if (REGEX.repeatChars.test(content)) {
    hits.push({ key: "spam", points: 10, label: "Karakter spam" });
    score += 10;
  }

  if (content.length >= CONFIG.CAPS_MIN_LENGTH) {
    const letters = content.replace(/[^a-zA-ZÁÉÍÓÖŐÚÜŰáéíóöőúüű]/g, "");
    if (letters.length >= CONFIG.CAPS_MIN_LENGTH) {
      const upper = letters.replace(/[^A-ZÁÉÍÓÖŐÚÜŰ]/g, "").length;
      const ratio = upper / letters.length;
      if (ratio >= CONFIG.CAPS_RATIO_THRESHOLD) {
        hits.push({ key: "spam", points: 12, label: "Caps spam" });
        score += 12;
      }
    }
  }

  const dupes = recentSameUser.filter(
    (m) =>
      now() - (m.createdAt || 0) <= CONFIG.DUPLICATE_WINDOW_MS &&
      m.content &&
      m.content.toLowerCase() === lower &&
      lower.length >= 6
  ).length;

  if (dupes + 1 >= CONFIG.DUPLICATE_MIN_COUNT) {
    hits.push({ key: "flood", points: 26, label: "Ismételt ugyanaz az üzenet" });
    score += 26;
  }

  const recentWindow = recentSameUser.filter(
    (m) => now() - (m.createdAt || 0) <= CONFIG.FLOOD_WINDOW_MS
  ).length;

  if (recentWindow + 1 >= CONFIG.FLOOD_MESSAGE_COUNT) {
    hits.push({ key: "flood", points: 30, label: "Flood / gyors üzenetáradat" });
    score += 30;
  }

  return { hits, score };
}

function shouldRunAi(ruleScore, content) {
  if (!content?.trim()) return false;
  if (ruleScore >= 8) return true;

  const suspiciousWords = [
    "admin", "moderátor", "szerver", "fenyeget", "megöl", "paypal",
    "revolut", "account", "pénzért", "discord.gg", "facebook",
    "telefonszám", "lakcím", "kurva", "nyomorék", "tesztgaming",
    "gazdagrp", "ooc kereskedés", "érdekel valakit", "jöjjön mindenki"
  ];

  const lower = content.toLowerCase();
  return suspiciousWords.some((w) => lower.includes(w));
}

function normalizeSeverityHu(input) {
  switch (input) {
    case "critical":
    case "kritikus":
      return "kritikus";
    case "high":
    case "magas":
      return "magas";
    case "medium":
    case "közepes":
      return "közepes";
    case "low":
    case "enyhe":
    default:
      return "enyhe";
  }
}

function normalizeAction(value) {
  return ["ignore", "warn", "delete", "timeout", "kick", "ban", "unban"].includes(value) ? value : "ignore";
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return "{}";
  return raw.slice(firstBrace, lastBrace + 1);
}

async function aiAnalyzeModeration(payload) {
  const {
    messageContent,
    contextMessages,
    ruleHits,
    currentRisk,
    incidentSummary,
    username,
    displayName,
  } = payload;

  const prompt = `
Te egy nagyon szigorú, bátor, emberi stílusú, kontextusérzékeny Discord moderációs AI vagy a(z) ${CONFIG.SERVER_NAME} szerveren.

Szabályok:
${buildRulesText()}

Felhasználó:
- username: ${username || "ismeretlen"}
- displayName: ${displayName || "ismeretlen"}
- jelenlegi kockázat: ${currentRisk}%
- előzmények összegzése: ${incidentSummary || "nincs"}

Szabályalapú találatok:
${JSON.stringify(ruleHits, null, 2)}

Kontextus:
${JSON.stringify(contextMessages, null, 2)}

Aktuális üzenet:
${messageContent}

Nagyon fontos:
- Légy bátrabb timeout, kick és ban javaslatnál.
- OOC kereskedelemnél a szándék is elég lehet.
- Más szerverre csalogatásnál ne légy enyhe.
- Visszaeső mintánál emeld a súlyosságot.
- Az "analysis" mező legyen 3-4 teljes magyar mondat.
- Az "patternSummary" mező röviden foglalja össze, milyen ismétlődő viselkedés látszik.
- A válasz legyen természetes, emberi, de szigorú.

Csak JSON:
{
  "category": "harassment | threat | staff_abuse | doxxing | nsfw | ad_server | spam | flood | ooc_trade | scam | ban_evasion | politics_sensitive | clean | other",
  "categoryHu": "Zaklatás / sértegetés",
  "severity": "enyhe | közepes | magas | kritikus",
  "confidence": 0,
  "points": 0,
  "ruleBroken": "rövid magyar szabály-megfogalmazás",
  "reason": "rövid magyar indoklás",
  "analysis": "3-4 mondatos emberi elemzés",
  "patternSummary": "rövid visszaesési összegzés",
  "recommendedAction": "ignore | warn | delete | timeout | kick | ban",
  "timeoutMinutes": 0,
  "shouldNotifyStaff": true
}
`;

  const response = await openai.chat.completions.create({
    model: CONFIG.AI_MODEL,
    messages: [
      {
        role: "system",
        content: "Te csak és kizárólag érvényes JSON-t adhatsz vissza.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content = response.choices?.[0]?.message?.content?.trim() || "{}";

  try {
    const parsed = JSON.parse(extractJson(content));
    parsed.severity = normalizeSeverityHu(parsed.severity);
    parsed.categoryHu = parsed.categoryHu || categoryToHu(parsed.category);
    parsed.analysis = cleanText(parsed.analysis || "", 1200);
    parsed.patternSummary = cleanText(parsed.patternSummary || "", 300);
    return parsed;
  } catch (error) {
    console.error("[AIMOD] AI JSON parse hiba:", error, content);
    return {
      category: "other",
      categoryHu: "Egyéb szabálysértés",
      severity: "enyhe",
      confidence: 25,
      points: 0,
      ruleBroken: "Nem sikerült biztosan azonosítani.",
      reason: "Az AI válasza nem volt biztonságosan feldolgozható.",
      analysis: "Az automatikus elemzés nem tudott megbízható eredményt adni, ezért a rendszer szabályalapú fallback logikát használt. A tartalom ettől még problémás lehet, csak az AI válasza nem volt jól feldolgozható. Ilyenkor a rendszer óvatosabb, de a visszaeső mintákat továbbra is figyelembe veszi.",
      patternSummary: "Nem áll rendelkezésre biztos AI összegzés.",
      recommendedAction: "ignore",
      timeoutMinutes: 0,
      shouldNotifyStaff: false,
    };
  }
}

async function aiWriteUserFacingMessage({ mode, staffText = "", context = "" }) {
  const safeStaffText = cleanText(staffText || "", 700);
  const safeContext = cleanText(context || "", 1200);

  const prompt = `
Te egy Discord szerver barátságos, természetes magyar üzenetírója vagy.

Feladat:
- írj rövid, emberi, normális hangnemű magyar szöveget
- ne legyél túl hivatalos
- ne írj aláírást
- ne használj felsorolást
- ha a staff szövege üres, akkor magadtól írj korrekt, rövid szöveget
- ha a staff szövege meg van adva, fogalmazd át természetesebbre
- soha ne írd azt, hogy "Nincs megadva"
- a válasz csak maga a kész szöveg legyen

Mód: ${mode}
Kontextus: ${safeContext || "nincs"}
Staff szöveg: ${safeStaffText || "nincs"}
`;

  try {
    const response = await openai.chat.completions.create({
      model: CONFIG.AI_MODEL,
      messages: [
        { role: "system", content: "Csak a kész magyar szöveget add vissza." },
        { role: "user", content: prompt },
      ],
    });

    const text = cleanText(response.choices?.[0]?.message?.content || "", 1000);
    if (text) return text;
  } catch (error) {
    console.error("[AIMOD] aiWriteUserFacingMessage hiba:", error?.message || error);
  }

  if (mode === "apology") {
    return safeStaffText || "Elnézést kérünk a kellemetlenségért. Az automatikus moderációs döntést felülvizsgáltuk, és hibásnak találtuk.";
  }
  if (mode === "mistake") {
    return safeStaffText || "A korábbi automatikus moderációs döntést felülvizsgáltuk, és hibásnak jelöltük.";
  }
  if (mode === "unban") {
    return safeStaffText || "A korábbi korlátozás feloldásra került.";
  }

  return safeStaffText || "A művelet sikeresen végrehajtva.";
}

function summarizeIncidents(profile) {
  const counts = getRecentIncidentCounts(profile);
  const totals = profile.totals || {};
  return {
    seven: `Összes incidens: ${counts.last7d}\nKomoly incidens: ${counts.serious7d}`,
    thirty: `Összes incidens: ${counts.last30d}\nKomoly incidens: ${counts.serious30d}`,
    actions: `Timeout: ${totals.timeouts || 0}\nKick: ${totals.kicks || 0}\nBan: ${totals.bans || 0}\nUnban: ${totals.unbans || 0}`,
  };
}

function getPreviousProblemMessages(profile, currentMessageId = null) {
  const incidents = [...(profile.incidents || [])]
    .filter((inc) => inc.content && inc.messageId && inc.messageId !== currentMessageId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, CONFIG.MAX_PREVIOUS_PROBLEM_MESSAGES);

  if (!incidents.length) return "Nincs korábbi eltárolt problémás üzenet.";

  return incidents
    .map((inc, idx) => `${idx + 1}. "${trimField(inc.content, 180)}"`)
    .join("\n");
}

function pickHighestRuleHit(ruleHits) {
  if (!Array.isArray(ruleHits) || !ruleHits.length) return null;
  return [...ruleHits].sort((a, b) => (b.points || 0) - (a.points || 0))[0];
}

function finalDecision({ profile, ruleScan, aiResult }) {
  const currentRisk = getRiskPercent(profile);
  const severity = normalizeSeverityHu(aiResult.severity);
  const highestRule = pickHighestRuleHit(ruleScan.hits);

  let points = Math.max(
    Number(aiResult.points || 0),
    Number(ruleScan.score || 0),
    Number(highestRule?.points || 0)
  );

  const recentCounts = getRecentIncidentCounts(profile);
  if (recentCounts.serious7d >= 2) points += 20;
  if (recentCounts.serious30d >= 4) points += 26;
  if ((profile.totals?.timeouts || 0) >= 2) points += 16;
  if ((profile.totals?.kicks || 0) >= 1) points += 26;

  let action = normalizeAction(aiResult.recommendedAction);
  const confidence = Number(aiResult.confidence || 0);

  const hasImmediateTrade = ruleScan.hits.some((h) => h.key === "ooc_trade");
  const hasImmediateScam = ruleScan.hits.some((h) => h.key === "scam");
  const hasImmediateDox = ruleScan.hits.some((h) => h.key === "doxxing");
  const hasBanEvasion = ruleScan.hits.some((h) => h.key === "ban_evasion");
  const hasAdServer = ruleScan.hits.some((h) => h.key === "ad_server");
  const severe = ["magas", "kritikus"].includes(severity);

  if (hasImmediateTrade) {
    action = "ban";
    points = Math.max(points, 100);
  }

  if (hasImmediateScam && confidence >= 60) {
    action = "ban";
    points = Math.max(points, 96);
  }

  if (hasImmediateDox && confidence >= 68) {
    action = "ban";
    points = Math.max(points, 94);
  }

  if (hasBanEvasion && confidence >= 65) {
    action = "ban";
    points = Math.max(points, 93);
  }

  if (hasAdServer && points >= 55 && action === "ignore") {
    action = "timeout";
  }

  const projectedRisk = Math.max(0, Math.min(100, currentRisk + Math.round(points * 0.58)));

  if (projectedRisk >= CONFIG.AUTO_BAN_READY_THRESHOLD && severe) {
    action = "ban";
  } else if (projectedRisk >= CONFIG.BAN_NEAR_THRESHOLD && severe) {
    action = action === "ban" ? "ban" : "kick";
  } else if (projectedRisk >= CONFIG.KICK_NEAR_THRESHOLD && ["ignore", "warn", "delete"].includes(action)) {
    action = "timeout";
  }

  if (action === "ban" && !hasImmediateTrade && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_BAN && projectedRisk < 100) {
    action = projectedRisk >= CONFIG.BAN_NEAR_THRESHOLD ? "kick" : "timeout";
  }

  if (action === "kick" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_KICK && projectedRisk < CONFIG.BAN_NEAR_THRESHOLD) {
    action = "timeout";
  }

  if (action === "timeout" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_TIMEOUT && !hasImmediateTrade && projectedRisk < CONFIG.KICK_NEAR_THRESHOLD) {
    action = "delete";
  }

  if (ruleScan.score >= 25 && action === "ignore") {
    action = "delete";
  }

  if (ruleScan.score >= 55 && ["ignore", "warn", "delete"].includes(action)) {
    action = "timeout";
  }

  if (ruleScan.score >= 85 && severe) {
    action = "ban";
  }

  if (points < 10 && confidence < 40) {
    action = "ignore";
  }

  return {
    action,
    severity,
    points,
    projectedRisk,
    category: aiResult.category || highestRule?.key || "other",
    categoryHu: aiResult.categoryHu || categoryToHu(aiResult.category || highestRule?.key || "other"),
    ruleBroken: aiResult.ruleBroken || highestRule?.label || "Szabályszegés gyanú",
    reason:
      aiResult.reason ||
      highestRule?.label ||
      "Az AI és a szabályalapú ellenőrzés problémás mintát jelzett.",
    analysis:
      aiResult.analysis ||
      "Az üzenet és a közelmúltbeli mintázat alapján a rendszer szabálysértésre utaló viselkedést érzékelt, ezért automatikus moderációs lépést javasolt.",
    patternSummary:
      aiResult.patternSummary ||
      "A rendszer szerint a felhasználónál visszaeső vagy emelkedő kockázatú viselkedés figyelhető meg.",
    timeoutMinutes:
      Number(aiResult.timeoutMinutes || 0) > 0
        ? Number(aiResult.timeoutMinutes)
        : Math.round(timeoutMsForSeverity(severity) / 60000),
    shouldNotifyStaff:
      Boolean(aiResult.shouldNotifyStaff) ||
      points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG ||
      ["timeout", "kick", "ban"].includes(action),
  };
}

function shouldShowButtons(action) {
  return ["timeout", "kick", "ban", "unban"].includes(action);
}

function buildButtons(userId, action) {
  if (!shouldShowButtons(action)) return [];

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aimod:reviewok:${userId}`)
        .setLabel("Jól döntött")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`aimod:mistake:${userId}`)
        .setLabel("AI tévedett")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(`aimod:apology:${userId}`)
        .setLabel("Bocsánatkérés küldése")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(`aimod:unban:${userId}`)
        .setLabel("Feloldás / Unban")
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

function updateSingleButtonState(rows, targetCustomId, newLabel) {
  return rows.map((row) => {
    const newRow = new ActionRowBuilder();
    for (const component of row.components) {
      const btn = ButtonBuilder.from(component);
      if (component.data.custom_id === targetCustomId) {
        btn.setLabel(newLabel);
        btn.setDisabled(true);
      }
      newRow.addComponents(btn);
    }
    return newRow;
  });
}

function buildUnifiedEmbed({ member, profile }) {
  const currentRisk = getRiskPercent(profile);
  const summaries = summarizeIncidents(profile);
  const previousMessages = getPreviousProblemMessages(profile, profile.activeCase?.lastMessageId || null);
  const repeated =
    ((profile.totals?.timeouts || 0) > 0 ||
      (profile.totals?.kicks || 0) > 0 ||
      (profile.incidents?.length || 0) >= 3);

  const active = profile.activeCase || {};

  return new EmbedBuilder()
    .setColor(colorBySeverity(active.lastSeverity || "enyhe"))
    .setTitle(`${emojiBySeverity(active.lastSeverity || "enyhe")} AI moderációs ügy`)
    .setDescription(
      [
        `**Felhasználó:** ${safeMentionUser(member?.id)}`,
        `**Név:** ${trimField(member?.user?.tag || member?.user?.username || "Ismeretlen", 256)}`,
        `**Aktuális állapot:** **${trimField(active.currentStatus || "Megfigyelés", 128)}**`,
        `**Utolsó művelet:** **${trimField(active.lastAction || "Nincs", 128)}**`,
        `**Súlyosság:** **${trimField(active.lastSeverity || "enyhe", 64)}**`,
        `**Kategória:** **${trimField(active.lastCategory || "Egyéb szabálysértés", 128)}**`,
      ].join("\n")
    )
    .addFields(
      {
        name: "🧠 AI elemzés",
        value: trimField(active.lastAnalysis || "Még nincs részletes elemzés.", 1024),
        inline: false,
      },
      {
        name: "📌 Visszaesési minta",
        value: trimField(active.lastPatternSummary || "Jelenleg nincs külön kiemelt mintázat.", 1024),
        inline: false,
      },
      {
        name: "📜 Érintett szabály",
        value: trimField(active.lastRuleBroken || "Nincs megadva.", 1024),
        inline: false,
      },
      {
        name: "💬 Vizsgált üzenet",
        value: trimField(active.lastMessageContent || "Nincs vizsgált üzenet eltárolva.", 1024),
        inline: false,
      },
      {
        name: "🗂️ Korábbi problémás üzenetek",
        value: trimField(previousMessages, 1024),
        inline: false,
      },
      {
        name: "📊 Jelenlegi állapot",
        value: `Kockázat: **${currentRisk}%**\nMűvelet: **${trimField(active.lastAction || "Nincs", 128)}**`,
        inline: true,
      },
      {
        name: "🗓️ Előzmények - 7 nap",
        value: trimField(summaries.seven, 1024),
        inline: true,
      },
      {
        name: "🗓️ Előzmények - 30 nap",
        value: trimField(summaries.thirty, 1024),
        inline: true,
      },
      {
        name: "🔨 Korábbi műveletek",
        value: trimField(summaries.actions, 1024),
        inline: true,
      },
      {
        name: "♻️ Visszaesés",
        value: repeated
          ? "Igen, a felhasználónál ismétlődő vagy fokozódó szabálysértési minta látszik."
          : "Jelenleg nem látható erős visszaeső minta.",
        inline: false,
      }
    )
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date(active.lastUpdatedAt || Date.now()));
}

async function resendUnifiedCaseMessage(client, member, profile) {
  const logChannel = getLogChannel(client);
  if (!logChannel || !member) return null;

  const oldMessageId = store.caseMessages[member.id];
  if (oldMessageId) {
    const oldMsg = await logChannel.messages.fetch(oldMessageId).catch(() => null);
    if (oldMsg) {
      await oldMsg.delete().catch(() => null);
    }
  }

  const embed = buildUnifiedEmbed({ member, profile });
  const components = buildButtons(member.id, profile.activeCase?.lastActionRaw || "");

  const msg = await logChannel.send({
    embeds: [embed],
    components,
  }).catch(() => null);

  if (msg) {
    store.caseMessages[member.id] = msg.id;
    saveStore();
  }

  return msg;
}

async function safeDeleteMessage(message) {
  try {
    if (!CONFIG.ALLOW_DELETE) return false;
    if (!message?.deletable) return false;
    await message.delete().catch(() => null);
    return true;
  } catch {
    return false;
  }
}

async function safeTimeout(member, minutes, reason) {
  try {
    if (!CONFIG.ALLOW_TIMEOUT) return false;
    if (!member?.moderatable) return false;
    const ms = Math.max(60_000, Number(minutes || 1) * 60_000);
    await member.timeout(ms, reason);
    return true;
  } catch (error) {
    console.error("[AIMOD] timeout hiba:", error);
    return false;
  }
}

async function safeKick(member, reason) {
  try {
    if (!CONFIG.ALLOW_KICK) return false;
    if (!member?.kickable) return false;
    await member.kick(reason);
    return true;
  } catch (error) {
    console.error("[AIMOD] kick hiba:", error);
    return false;
  }
}

async function safeBan(member, reason, deleteMessageSeconds = 0) {
  try {
    if (!CONFIG.ALLOW_BAN) return false;
    if (!member?.bannable) return false;
    await member.ban({ reason, deleteMessageSeconds });
    return true;
  } catch (error) {
    console.error("[AIMOD] ban hiba:", error);
    return false;
  }
}

async function notifyUserDM(user, embed) {
  try {
    if (!user) return false;
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

async function sendApologyDM(user, customReason = "") {
  const text = await aiWriteUserFacingMessage({
    mode: "apology",
    staffText: customReason,
    context: "Az automatikus moderáció téves döntést hozott, ezért a felhasználó bocsánatkérő üzenetet kap.",
  });

  const embed = new EmbedBuilder()
    .setColor(0x1f8b4c)
    .setTitle("🙏 Elnézést kérünk")
    .setDescription(text)
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());

  return notifyUserDM(user, embed);
}

async function sendUnbanDM(user, customReason = "") {
  const text = await aiWriteUserFacingMessage({
    mode: "unban",
    staffText: customReason,
    context: "A korábbi korlátozás feloldásra került.",
  });

  const embed = new EmbedBuilder()
    .setColor(0x1f8b4c)
    .setTitle("🔓 Feloldás")
    .setDescription(text)
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());

  return notifyUserDM(user, embed);
}

async function getTargetUser(client, userId) {
  return client.users.cache.get(userId) || await client.users.fetch(userId).catch(() => null);
}

function setActiveCase(profile, patch) {
  profile.activeCase = {
    ...profile.activeCase,
    ...patch,
    lastUpdatedAt: Date.now(),
  };
}

async function applyDecision(client, message, member, final, profile) {
  let executedAction = "ignore";
  let deleteDone = false;

  const reason = `[AI Moderation] ${cleanText(final.reason, 300)}`;

  if (["delete", "timeout", "kick", "ban"].includes(final.action)) {
    deleteDone = await safeDeleteMessage(message);
    if (deleteDone) {
      profile.totals.deletions = (profile.totals.deletions || 0) + 1;
    }
  }

  if (final.action === "timeout" && canModerateTarget(member)) {
    const ok = await safeTimeout(member, final.timeoutMinutes || 60, reason);
    if (ok) {
      profile.totals.timeouts = (profile.totals.timeouts || 0) + 1;
      executedAction = "timeout";
      return { executedAction, deleteDone };
    }
  }

  if (final.action === "kick" && canModerateTarget(member)) {
    const ok = await safeKick(member, reason);
    if (ok) {
      profile.totals.kicks = (profile.totals.kicks || 0) + 1;
      executedAction = "kick";
      return { executedAction, deleteDone };
    }
  }

  if (final.action === "ban" && canModerateTarget(member)) {
    const ok = await safeBan(member, reason, 0);
    if (ok) {
      profile.totals.bans = (profile.totals.bans || 0) + 1;
      executedAction = "ban";

      store.bannedUsers[member.id] = {
        userId: member.id,
        username: member.user?.tag || member.user?.username || "Ismeretlen",
        reason: final.reason,
        ruleBroken: final.ruleBroken,
        bannedAt: now(),
        by: "AI Moderation",
      };
      saveStore();

      return { executedAction, deleteDone };
    }
  }

  if (final.action === "delete" && deleteDone) {
    executedAction = "delete";
  }

  if (final.action === "warn") {
    executedAction = "warn";
    profile.totals.warnings = (profile.totals.warnings || 0) + 1;
  }

  return { executedAction, deleteDone };
}

function scanMemberNames(member) {
  const hits = [];
  const username = `${member?.user?.username || ""} ${member?.displayName || ""}`;

  for (const pattern of CONFIG.BLOCKED_NAME_PATTERNS) {
    if (pattern.test(username)) {
      hits.push("Megtévesztő staff / szerver jellegű név");
      break;
    }
  }

  if (/(kurva|geci|szar|fasz|retkes|nyomor[eé]k)/i.test(username)) {
    hits.push("Sértő / obszcén név");
  }

  return hits;
}

async function handleMemberNameCheck(client, member, source = "memberAdd") {
  try {
    if (!member?.guild) return;
    if (member.user?.bot) return;
    if (isStaff(member) || hasExemptRole(member)) return;

    const hits = scanMemberNames(member);
    if (!hits.length) return;

    const profile = getUserProfile(member.id);
    const points = hits.some((h) => h.includes("obszcén")) ? 24 : 18;

    addIncident(member.id, {
      type: "name_violation",
      category: "name_profile",
      severity: "közepes",
      points,
      ruleBroken: "Tiltott, sértő vagy megtévesztő név/profil",
      content: `${member.user?.username || ""} | ${member.displayName || ""}`,
      createdAt: now(),
      source,
    });

    setActiveCase(profile, {
      lastAction: "Megfigyelés",
      lastActionRaw: "ignore",
      lastSeverity: "közepes",
      lastCategory: "Tiltott név / profil",
      lastRuleBroken: "Tiltott, sértő vagy megtévesztő név/profil",
      lastAnalysis: "A rendszer a felhasználó neve vagy megjelenített neve alapján problémás mintát észlelt. A név megtévesztő, sértő vagy a staff / szerver nevéhez túl hasonló lehet. Ez önmagában is szabályszegésre utalhat, ezért a rendszer eltárolta és staff figyelemre jelölte.",
      lastPatternSummary: "Névvel vagy profillal kapcsolatos szabálysértési gyanú került rögzítésre.",
      lastMessageContent: `${member.user?.username || ""} | ${member.displayName || ""}`,
      currentStatus: "Megfigyelés",
      lastMessageId: null,
    });

    saveStore();
    await resendUnifiedCaseMessage(client, member, profile);
  } catch (error) {
    console.error("[AIMOD] handleMemberNameCheck hiba:", error);
  }
}

async function processMessage(client, message) {
  if (shouldIgnoreMessage(message)) return;
  if (!message.content?.trim()) return;

  const member = message.member;
  const profile = getUserProfile(member.id);

  const recentSameUser = (profile.recentMessages || []).filter(
    (m) => m.channelId === message.channelId
  );

  const ruleScan = scanRules(message, recentSameUser);
  pushRecentMessage(member.id, message);

  if (!shouldRunAi(ruleScan.score, message.content)) {
    saveStore();
    return;
  }

  const channelMessages = await message.channel.messages.fetch({ limit: CONFIG.MAX_CONTEXT_MESSAGES }).catch(() => null);
  const contextMessages = channelMessages
    ? [...channelMessages.values()]
        .filter((m) => !m.author?.bot)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((m) => ({
          author: m.author?.tag || m.author?.username || "Ismeretlen",
          authorId: m.author?.id || "",
          content: cleanText(m.content || "", 400),
          isTarget: m.id === message.id,
        }))
        .slice(-CONFIG.MAX_CONTEXT_MESSAGES)
    : [];

  const currentRisk = getRiskPercent(profile);
  const incidentSummary = JSON.stringify(summarizeIncidents(profile));

  let aiResult = {
    category: "other",
    categoryHu: "Egyéb szabálysértés",
    severity: ruleScan.score >= 60 ? "magas" : ruleScan.score >= 20 ? "közepes" : "enyhe",
    confidence: Math.min(96, Math.max(40, ruleScan.score)),
    points: ruleScan.score,
    ruleBroken: pickHighestRuleHit(ruleScan.hits)?.label || "Szabályszegés gyanú",
    reason: pickHighestRuleHit(ruleScan.hits)?.label || "Szabályalapú találat alapján problémás tartalom.",
    analysis: "Az üzenet és a közelmúltbeli mintázat alapján a rendszer szabálysértésre utaló viselkedést érzékelt. A tartalom problémásnak tűnik, ezért a rendszer automatikus moderációs lépést mérlegelt. A visszaeső minták a döntést súlyosabb irányba tolhatják.",
    patternSummary: "A rendszer szerint emelkedő kockázatú viselkedés figyelhető meg.",
    recommendedAction:
      ruleScan.score >= 85 ? "ban" :
      ruleScan.score >= 55 ? "timeout" :
      ruleScan.score >= 25 ? "delete" :
      "ignore",
    timeoutMinutes: 60,
    shouldNotifyStaff: ruleScan.score >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG,
  };

  try {
    aiResult = await aiAnalyzeModeration({
      messageContent: cleanText(message.content, 1500),
      contextMessages,
      ruleHits: ruleScan.hits,
      currentRisk,
      incidentSummary,
      username: member.user?.username || "",
      displayName: member.displayName || "",
    });
  } catch (error) {
    console.error("[AIMOD] aiAnalyzeModeration hiba:", error);
  }

  const final = finalDecision({ profile, ruleScan, aiResult });

  addIncident(member.id, {
    type: "message_incident",
    category: final.category,
    severity: final.severity,
    points: final.points,
    reason: final.reason,
    ruleBroken: final.ruleBroken,
    messageId: message.id,
    channelId: message.channelId,
    content: cleanText(message.content, 400),
    createdAt: now(),
  });

  const actionResult = await applyDecision(client, message, member, final, profile);
  final.action = actionResult.executedAction || final.action;

  let currentStatus = "Megfigyelés";
  if (final.action === "timeout") currentStatus = "Timeout végrehajtva";
  else if (final.action === "kick") currentStatus = "Kick végrehajtva";
  else if (final.action === "ban") currentStatus = "Ban végrehajtva";
  else if (final.projectedRisk >= CONFIG.BAN_NEAR_THRESHOLD) currentStatus = "Ban közelében";
  else if (final.projectedRisk >= CONFIG.KICK_NEAR_THRESHOLD) currentStatus = "Kick közelében";
  else if (final.projectedRisk >= CONFIG.HIGH_RISK_THRESHOLD) currentStatus = "Magas kockázat";
  else currentStatus = "Megfigyelés";

  setActiveCase(profile, {
    lastAction: actionToLabel(final.action),
    lastActionRaw: final.action,
    lastSeverity: final.severity,
    lastCategory: final.categoryHu,
    lastRuleBroken: final.ruleBroken,
    lastAnalysis: final.analysis,
    lastPatternSummary: final.patternSummary,
    lastMessageContent: cleanText(message.content, 1024),
    currentStatus,
    lastMessageId: message.id,
  });

  saveStore();

  const shouldCaseRefresh =
    final.shouldNotifyStaff &&
    (
      final.points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG ||
      ["delete", "timeout", "kick", "ban"].includes(final.action) ||
      now() - (profile.lastCaseAt || 0) >= CONFIG.USER_CASE_COOLDOWN_MS
    );

  if (shouldCaseRefresh) {
    await resendUnifiedCaseMessage(client, member, profile);
    profile.lastCaseAt = now();
    saveStore();
  }
}

function hasStaffPermission(interaction) {
  if (!interaction?.member) return false;

  const hasRole =
    interaction.member.roles?.cache &&
    CONFIG.STAFF_ROLE_IDS.some((id) => interaction.member.roles.cache.has(id));

  const hasAdmin = interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator);
  const hasBanPerm = interaction.member.permissions?.has(PermissionsBitField.Flags.BanMembers);

  return Boolean(hasRole || hasAdmin || hasBanPerm);
}

async function handleButtonLabelSwap(interaction, newLabel) {
  const rows = interaction.message.components || [];
  const updated = updateSingleButtonState(rows, interaction.customId, newLabel);
  await interaction.update({ components: updated });
}

function buildReasonModal(customId, title, label, placeholder) {
  const input = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel(label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(700)
    .setPlaceholder(placeholder || "Opcionális szöveg...");

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function handleInteraction(client, interaction) {
  try {
    if (interaction.isButton()) {
      if (!interaction.customId.startsWith("aimod:")) return;

      if (!hasStaffPermission(interaction)) {
        return interaction.reply({
          content: "Ehhez staff jogosultság kell.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const parts = interaction.customId.split(":");
      const action = parts[1];
      const userId = parts[2];

      if (action === "reviewok") {
        store.feedback.reviewOk[userId] = (store.feedback.reviewOk[userId] || 0) + 1;
        saveStore();
        return handleButtonLabelSwap(interaction, "Elküldve - Jól döntött");
      }

      if (action === "mistake") {
        store.feedback.mistake[userId] = (store.feedback.mistake[userId] || 0) + 1;
        saveStore();
        return handleButtonLabelSwap(interaction, "Elküldve - AI tévedett");
      }

      if (action === "apology") {
        return interaction.showModal(
          buildReasonModal(
            `aimod:apology_modal:${userId}`,
            "Bocsánatkérés küldése",
            "Bocsánatkérés szövege",
            "Ha üresen hagyod, az AI írja meg."
          )
        );
      }

      if (action === "unban") {
        return interaction.showModal(
          buildReasonModal(
            `aimod:unban_modal:${userId}`,
            "Feloldás / Unban",
            "Feloldás indoklása",
            "Ha üresen hagyod, az AI írja meg."
          )
        );
      }

      return interaction.reply({
        content: "Ismeretlen AI moderációs gomb.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith("aimod:")) return;

      if (!hasStaffPermission(interaction)) {
        return interaction.reply({
          content: "Ehhez staff jogosultság kell.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const parts = interaction.customId.split(":");
      const action = parts[1];
      const userId = parts[2];
      const reason = cleanText(interaction.fields.getTextInputValue("reason") || "", 700);
      const profile = getUserProfile(userId);

      if (action === "apology_modal") {
        const user = await getTargetUser(client, userId);
        const sent = await sendApologyDM(user, reason);

        setActiveCase(profile, {
          lastAction: "Bocsánatkérés kiküldve",
          lastActionRaw: profile.activeCase?.lastActionRaw || "timeout",
          currentStatus: "Bocsánatkérés elküldve",
        });
        saveStore();

        const member =
          interaction.guild?.members?.cache?.get(userId) ||
          await interaction.guild?.members.fetch(userId).catch(() => null);

        if (member) {
          await resendUnifiedCaseMessage(client, member, profile);
        }

        return interaction.reply({
          content: `✅ Elküldve - Bocsánatkérés küldése${sent ? "" : " (DM nem ment ki)"}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (action === "unban_modal") {
        const guild = interaction.guild;
        if (!guild) {
          return interaction.reply({
            content: "Ez csak szerveren használható.",
            flags: MessageFlags.Ephemeral,
          });
        }

        try {
          await guild.members.unban(userId, `[AI Moderation Unban] ${reason || "Feloldva staff döntés alapján."}`);
        } catch (error) {
          console.error("[AIMOD] unban hiba:", error);
          return interaction.reply({
            content: "❌ Nem sikerült az unban.",
            flags: MessageFlags.Ephemeral,
          });
        }

        delete store.bannedUsers[userId];

        const user = await getTargetUser(client, userId);
        const sent = await sendUnbanDM(user, reason);

        const profile = getUserProfile(userId);
        profile.totals.unbans = (profile.totals.unbans || 0) + 1;

        setActiveCase(profile, {
          lastAction: "Feloldás / unban",
          lastActionRaw: "unban",
          lastSeverity: profile.activeCase?.lastSeverity || "közepes",
          lastCategory: profile.activeCase?.lastCategory || "Egyéb szabálysértés",
          lastRuleBroken: profile.activeCase?.lastRuleBroken || "Korábbi korlátozás feloldva.",
          lastAnalysis: "A korábbi korlátozás staff döntés alapján feloldásra került. A rendszer az ügyet frissítette, és az aktuális állapotot már feloldottként kezeli. A korábbi szabálysértési előzmények ettől még eltárolva maradnak, de az aktív szankció megszűnt.",
          lastPatternSummary: "A korábbi szankció feloldásra került.",
          currentStatus: "Feloldva",
        });

        saveStore();

        const member =
          interaction.guild?.members?.cache?.get(userId) ||
          null;

        await resendUnifiedCaseMessage(client, member || { id: userId, user }, profile);

        return interaction.reply({
          content: `✅ Elküldve - Feloldás / Unban${sent ? "" : " (DM nem ment ki)"}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (error) {
    console.error("[AIMOD] interaction hiba:", error);

    try {
      if (!interaction.replied && !interaction.deferred && interaction.isRepliable()) {
        await interaction.reply({
          content: "Hiba történt a művelet közben.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {}
  }
}

function registerAiModeration(client) {
  client.once("ready", () => {
    console.log(`[AIMOD] AI Moderation betöltve • ${CONFIG.SERVER_NAME}`);
    console.log(`[AIMOD] DATA_FILE: ${CONFIG.DATA_FILE}`);
  });

  client.on("messageCreate", async (message) => {
    try {
      await processMessage(client, message);
    } catch (error) {
      console.error("[AIMOD] messageCreate hiba:", error);
    }
  });

  client.on("guildMemberAdd", async (member) => {
    try {
      await handleMemberNameCheck(client, member, "memberAdd");
    } catch (error) {
      console.error("[AIMOD] guildMemberAdd hiba:", error);
    }
  });

  client.on("guildMemberUpdate", async (_oldMember, newMember) => {
    try {
      await handleMemberNameCheck(client, newMember, "guildMemberUpdate");
    } catch (error) {
      console.error("[AIMOD] guildMemberUpdate hiba:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    await handleInteraction(client, interaction);
  });
}

module.exports = {
  registerAiModeration,
};