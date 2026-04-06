"use strict";

const { getState } = require("./systempanel");
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
  MOD_LOG_CHANNEL_ID: "1485721532297908355",

  STAFF_ROLE_IDS: [
    "1403403484090470564",
    "1322545317995876397",
  ],

  EXEMPT_ROLE_IDS: [
    "1403401954712883200",
    "1322545317995876398",
    "1322545317995876399",
    "1322545317995876401",
    "1322545317995876400",
    "1322545317995876402",
  ],

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

  WATCH_THRESHOLD: 35,
  HIGH_RISK_THRESHOLD: 55,
  KICK_NEAR_THRESHOLD: 82,
  BAN_NEAR_THRESHOLD: 95,
  AUTO_BAN_READY_THRESHOLD: 100,

  MIN_AI_CONFIDENCE_FOR_TIMEOUT: 52,
  MIN_AI_CONFIDENCE_FOR_KICK: 68,
  MIN_AI_CONFIDENCE_FOR_BAN: 86,

  TIMEOUT_MINUTES_LOW: 15,
  TIMEOUT_MINUTES_MEDIUM: 60,
  TIMEOUT_MINUTES_HIGH: 360,
  TIMEOUT_MINUTES_CRITICAL: 1440,

  FLOOD_WINDOW_MS: 12_000,
  FLOOD_MESSAGE_COUNT: 10,
  DUPLICATE_WINDOW_MS: 45_000,
  DUPLICATE_MIN_COUNT: 3,
  MASS_MENTION_COUNT: 20,
  CAPS_MIN_LENGTH: 16,
  CAPS_RATIO_THRESHOLD: 0.72,
  EMOJI_SPAM_THRESHOLD: 10,
  REPEAT_CHAR_THRESHOLD: 15,

  MIN_INCIDENT_SCORE_FOR_LOG: 20,
  USER_CASE_COOLDOWN_MS: 15_000,
  DELETE_NOTICE_TTL_MS: 30_000,

  DECAY_DAYS_STRONG: 7,
  DECAY_DAYS_MEDIUM: 30,
  DECAY_DAYS_LIGHT: 90,

  UNBAN_RISK_RELIEF_POINTS: 35,
  UNBAN_REMOVE_LAST_INCIDENTS: 2,

  SAFE_MODE_MAX_ACTION: "timeout",
  SAFE_MODE_CONFIDENCE_PENALTY: 12,
  SAFE_MODE_POINT_MULTIPLIER: 0.62,

  WATCH_MODE_ENABLED: true,
  WATCH_BASE_POINTS: 8,
  WATCH_WINDOW_MS: 20 * 60 * 1000,

  SUSPICION_DECAY_DAYS: 14,
  SUSPICION_WARN_THRESHOLD: 24,
  SUSPICION_TIMEOUT_THRESHOLD: 52,
  SUSPICION_KICK_THRESHOLD: 82,

  FALSE_POSITIVE_SHIELD: true,
  FEEDBACK_WEIGHT_LIMIT: 18,
  BYPASS_EXTRA_POINTS: 12,
  REPLY_TARGET_BONUS_POINTS: 8,

DATA_FILE: path.join(
  process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname,
  "aimoderation-data.json"
),

  RULES: [
    "Tilos más felhasználók piszkálása, zaklatása, szidása, fenyegetése, lejáratása, abuzálása, kifigurázása.",
    "Tilos a szerver, adminok, fejlesztők, vezetőség obszcén, degradáló, nem szalonképes szidalmazása.",
    "Tilos mások nem publikus adatainak kiadása és felhasználása.",
    "Tilos politikai, etnikai, pornográf, NSFW, gusztustalan vagy kétértelműen tiltott tartalom.",
    "Tilos más szerverek hirdetése / szidása, linkkel, névvel, avatarban, képpel vagy más formában.",
    "Tilos floodolni, spamelni, indokolatlanul tagelni.",
    "Tilos adminnak / vezetőségnek normális indok nélkül DM-et küldeni.",
    "Tilos az OOC kereskedelem és már annak szándéka is. Ez súlyos szankciót vonhat maga után.",
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
    caseMessages: {},
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(CONFIG.DATA_FILE)) {
      fs.writeFileSync(
        CONFIG.DATA_FILE,
        JSON.stringify(getDefaultStore(), null, 2),
        "utf8"
      );
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

async function getLogChannel(client) {
  if (
    !CONFIG.MOD_LOG_CHANNEL_ID ||
    CONFIG.MOD_LOG_CHANNEL_ID.startsWith("IDE_")
  ) {
    return null;
  }

  return (
    client.channels.cache.get(CONFIG.MOD_LOG_CHANNEL_ID) ||
    (await client.channels.fetch(CONFIG.MOD_LOG_CHANNEL_ID).catch(() => null))
  );
}

function getUserProfile(userId) {
  if (!store.users[userId]) {
    store.users[userId] = {
      incidents: [],
      recentMessages: [],
      lastCaseAt: 0,
      watchUntil: 0,
      suspicion: 0,
      behaviorScore: 0,
      escalationLevel: 0,
      lastIncidentAt: 0,
      noticeState: {
        lastNoticeAt: 0,
        lastNoticeAction: "",
        lastNoticeMessageId: null,
      },
      rehab: {
        score: 0,
        goodDays: 0,
        level: "nincs",
        lastCheckAt: 0,
        lastImprovedAt: 0,
      },
      activeCase: {
        lastAction: "Nincs",
        lastActionRaw: "ignore",
        lastReason: "",
        lastCategory: "",
        lastSeverity: "",
        lastAnalysis: "",
        lastPatternSummary: "",
        lastRuleBroken: "",
        lastMessageContent: "",
        lastMessageId: null,
        lastChannelId: null,
        lastProjectedRisk: 0,
        lastEvidence: "",
        lastModerationMode: "balanced",
        lastShieldReason: "",
        lastBypassScore: 0,
        lastReplyTarget: "",
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
        forgiveness: 0,
        watches: 0,
        shields: 0,
      },
    };
  }

  const profile = store.users[userId];

  if (!Array.isArray(profile.incidents)) profile.incidents = [];
  if (!Array.isArray(profile.recentMessages)) profile.recentMessages = [];
  if (typeof profile.lastCaseAt !== "number") profile.lastCaseAt = 0;
  if (typeof profile.watchUntil !== "number") profile.watchUntil = 0;
  if (typeof profile.suspicion !== "number") profile.suspicion = 0;
  if (typeof profile.behaviorScore !== "number") profile.behaviorScore = 0;
  if (typeof profile.escalationLevel !== "number") profile.escalationLevel = 0;
  if (typeof profile.lastIncidentAt !== "number") profile.lastIncidentAt = 0;

  profile.noticeState = {
    lastNoticeAt: 0,
    lastNoticeAction: "",
    lastNoticeMessageId: null,
    ...(profile.noticeState || {}),
  };

  profile.activeCase = {
    lastAction: "Nincs",
    lastActionRaw: "ignore",
    lastReason: "",
    lastCategory: "",
    lastSeverity: "",
    lastAnalysis: "",
    lastPatternSummary: "",
    lastRuleBroken: "",
    lastMessageContent: "",
    lastMessageId: null,
    lastChannelId: null,
    lastProjectedRisk: 0,
    lastEvidence: "",
    lastModerationMode: "balanced",
    lastShieldReason: "",
    lastBypassScore: 0,
    lastReplyTarget: "",
    lastUpdatedAt: 0,
    currentStatus: "Megfigyelés",
    ...(profile.activeCase || {}),
  };

  profile.totals = {
    warnings: 0,
    deletions: 0,
    timeouts: 0,
    kicks: 0,
    bans: 0,
    unbans: 0,
    forgiveness: 0,
    watches: 0,
    shields: 0,
    ...(profile.totals || {}),
  };

  profile.rehab = {
    score: 0,
    goodDays: 0,
    level: "nincs",
    lastCheckAt: 0,
    lastImprovedAt: 0,
    ...(profile.rehab || {}),
  };

  return profile;
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
    profile.recentMessages = profile.recentMessages.slice(
      -CONFIG.MAX_LAST_MESSAGES_PER_USER
    );
  }
}

function addIncident(userId, incident) {
  const profile = getUserProfile(userId);
  profile.incidents.push(incident);

  if (profile.incidents.length > CONFIG.MAX_PROFILE_INCIDENTS) {
    profile.incidents = profile.incidents.slice(-CONFIG.MAX_PROFILE_INCIDENTS);
  }

  profile.lastIncidentAt = Date.now();

  profile.rehab = profile.rehab || {};
  profile.rehab.score = Math.max(0, Number(profile.rehab.score || 0) - 18);
  profile.rehab.goodDays = 0;
  profile.rehab.level = "visszaeső";
  profile.rehab.lastCheckAt = Date.now();
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
  if (channel.parentId && CONFIG.EXEMPT_CATEGORY_IDS.includes(channel.parentId))
    return true;
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

function hasStaffPermission(interaction) {
  if (!interaction?.member) return false;

  const member = interaction.member;
  return Boolean(
    member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
      member.permissions?.has(PermissionsBitField.Flags.BanMembers) ||
      member.permissions?.has(PermissionsBitField.Flags.KickMembers) ||
      isStaff(member)
  );
}

async function findGuildMemberByName(guild, input) {
  const query = cleanText(input || "", 100).toLowerCase();
  if (!guild || !query) return null;

  await guild.members.fetch().catch(() => null);

  const exact = guild.members.cache.find((member) => {
    const username = (member.user?.username || "").toLowerCase();
    const tag = (member.user?.tag || "").toLowerCase();
    const displayName = (member.displayName || "").toLowerCase();
    const globalName = (member.user?.globalName || "").toLowerCase();

    return (
      username === query ||
      tag === query ||
      displayName === query ||
      globalName === query
    );
  });

  if (exact) return exact;

  const partial = guild.members.cache.find((member) => {
    const username = (member.user?.username || "").toLowerCase();
    const tag = (member.user?.tag || "").toLowerCase();
    const displayName = (member.displayName || "").toLowerCase();
    const globalName = (member.user?.globalName || "").toLowerCase();

    return (
      username.includes(query) ||
      tag.includes(query) ||
      displayName.includes(query) ||
      globalName.includes(query)
    );
  });

  return partial || null;
}

function colorBySeverity(severity) {
  switch (severity) {
    case "kritikus":
      return 0xaa0000;
    case "magas":
      return 0xd63c3c;
    case "közepes":
      return 0xff8a00;
    case "enyhe":
      return 0xf0c419;
    default:
      return 0x2f3136;
  }
}

function emojiBySeverity(severity) {
  switch (severity) {
    case "kritikus":
      return "🛑";
    case "magas":
      return "🚨";
    case "közepes":
      return "⚠️";
    case "enyhe":
      return "🟡";
    default:
      return "ℹ️";
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

function actionToLabel(action) {
  switch (action) {
    case "ignore":
      return "Nincs automata lépés";
    case "watch":
      return "Megfigyelés / watch";
    case "warn":
      return "Figyelmeztetés";
    case "delete":
      return "Üzenet törlése";
    case "timeout":
      return "Timeout / mute";
    case "kick":
      return "Kick";
    case "ban":
      return "Ban";
    case "unban":
      return "Feloldás / unban";
    default:
      return "Nincs";
  }
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
  return [
    "ignore",
    "watch",
    "warn",
    "delete",
    "timeout",
    "kick",
    "ban",
    "unban",
  ].includes(value)
    ? value
    : "ignore";
}

function timeoutMsForSeverity(severity) {
  switch (severity) {
    case "kritikus":
      return CONFIG.TIMEOUT_MINUTES_CRITICAL * 60_000;
    case "magas":
      return CONFIG.TIMEOUT_MINUTES_HIGH * 60_000;
    case "közepes":
      return CONFIG.TIMEOUT_MINUTES_MEDIUM * 60_000;
    default:
      return CONFIG.TIMEOUT_MINUTES_LOW * 60_000;
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
  risk -= (profile.totals?.forgiveness || 0) * 10;

  const rehabScore = Number(profile.rehab?.score || 0);
  risk -= rehabScore * 0.35;

  return Math.max(0, risk);
}

function getRiskPercent(profile) {
  applyDailyDecay(profile);
  const rehabChanged = applyRehabProgress(profile);
  if (rehabChanged) {
    saveStore();
  }

  return Math.max(0, Math.min(100, Math.round(getRawRiskValue(profile))));
}
function getRiskBar(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent || 0)));

  const positive = 100 - clamped;
  const negative = clamped;

  const posBlocks = Math.round((positive / 100) * 10);
  const negBlocks = 10 - posBlocks;

  return "🟩".repeat(posBlocks) + "🟥".repeat(negBlocks);
}
function applyDailyDecay(profile) {
  const now = Date.now();

  if (!profile.lastDecay) {
    profile.lastDecay = now;
    return;
  }

  const ONE_DAY = 24 * 60 * 60 * 1000;
  const daysPassed = Math.floor((now - profile.lastDecay) / ONE_DAY);

  if (daysPassed <= 0) return;

  const lastIncident = profile.lastIncidentAt || 0;
  const daysSinceIncident = Math.floor((now - lastIncident) / ONE_DAY);

  for (let d = 0; d < daysPassed; d++) {

    let suspicionDecay = 0.98;
    let pointsDecay = 0.995;

    // 🔥 JÓ VISELKEDÉS BOOST

    if (daysSinceIncident >= 3) {
      suspicionDecay = 0.95;
      pointsDecay = 0.98;
    }

    if (daysSinceIncident >= 7) {
      suspicionDecay = 0.90;
      pointsDecay = 0.95;
    }

    if (daysSinceIncident >= 14) {
      suspicionDecay = 0.85;
      pointsDecay = 0.90;
    }

    // alkalmazás
    profile.suspicion = Math.max(0, (profile.suspicion || 0) * suspicionDecay);

    if (profile.incidents && profile.incidents.length > 0) {
      profile.incidents.forEach(inc => {
        if (inc.points) inc.points *= pointsDecay;
      });
    }
  }

  profile.lastDecay = now;

  saveStore();
}

function formatRiskBlock(profile) {
  const risk = getRiskPercent(profile);
  return `${getRiskBar(risk)}\n**${risk}%** (${getRiskBand(profile)})`;
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

function getModerationMode() {
  return getState("aimod_safe_mode") ? "safe" : "balanced";
}

function getFeedbackDelta(userId) {
  const ok = Number(store.feedback?.reviewOk?.[userId] || 0);
  const mistakes = Number(store.feedback?.mistake?.[userId] || 0);
  return Math.max(
    -CONFIG.FEEDBACK_WEIGHT_LIMIT,
    Math.min(CONFIG.FEEDBACK_WEIGHT_LIMIT, ok * 2 - mistakes * 4)
  );
}

function getSuspicionDecayWeight(ageMs) {
  const d = CONFIG.SUSPICION_DECAY_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs <= d) return 1;
  if (ageMs <= d * 2) return 0.45;
  return 0.12;
}

function getSuspicionValue(profile) {
  const current = now();
  let value = Number(profile.suspicion || 0);

  for (const inc of profile.incidents || []) {
    const age = current - (inc.createdAt || current);
    if (Number(inc.suspicion || 0) > 0) {
      value += Number(inc.suspicion || 0) * getSuspicionDecayWeight(age);
    }
  }

  return Math.max(0, Math.round(value));
}
function getRehabLevel(score) {
  if (score >= 80) return "megbízható";
  if (score >= 55) return "stabil";
  if (score >= 30) return "javuló";
  if (score >= 10) return "figyelt";
  return "nincs";
}

function applyRehabProgress(profile) {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  if (!profile.rehab) {
    profile.rehab = {
      score: 0,
      goodDays: 0,
      level: "nincs",
      lastCheckAt: now,
      lastImprovedAt: 0,
    };
  }

  if (!profile.rehab.lastCheckAt) {
    profile.rehab.lastCheckAt = now;
    return false;
  }

  const daysPassed = Math.floor((now - profile.rehab.lastCheckAt) / ONE_DAY);
  if (daysPassed <= 0) return false;

  const lastIncidentAt = Number(profile.lastIncidentAt || 0);
  const daysSinceIncident =
    lastIncidentAt > 0 ? Math.floor((now - lastIncidentAt) / ONE_DAY) : 9999;

  let changed = false;

  for (let i = 0; i < daysPassed; i++) {
    let dailyGain = 0;

    if (daysSinceIncident >= 1) dailyGain = 2;
    if (daysSinceIncident >= 3) dailyGain = 3;
    if (daysSinceIncident >= 7) dailyGain = 4;
    if (daysSinceIncident >= 14) dailyGain = 5;
    if (daysSinceIncident >= 30) dailyGain = 6;

    if (dailyGain > 0) {
      profile.rehab.score = Math.min(100, Number(profile.rehab.score || 0) + dailyGain);
      profile.rehab.goodDays = Number(profile.rehab.goodDays || 0) + 1;
      profile.rehab.lastImprovedAt = now;
      changed = true;
    }
  }

  profile.rehab.level = getRehabLevel(profile.rehab.score);
  profile.rehab.lastCheckAt = now;

  return changed;
}

function getRehabDisplay(profile) {
  const rehab = profile.rehab || {};
  return (
    `Szint: **${rehab.level || "nincs"}**\n` +
    `Pont: **${Number(rehab.score || 0)}**\n` +
    `Nyugodt napok: **${Number(rehab.goodDays || 0)}**`
  );
}
function isWatchActive(profile) {
  return Boolean(
    CONFIG.WATCH_MODE_ENABLED && Number(profile.watchUntil || 0) > now()
  );
}

function extendWatch(profile, ms = CONFIG.WATCH_WINDOW_MS) {
  profile.watchUntil = Math.max(Number(profile.watchUntil || 0), now()) + ms;
  profile.totals.watches = (profile.totals.watches || 0) + 1;
}

function normalizeBypassText(content = "") {
  return String(content || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\*_~`|.,;:!?()[\]{}<>\/\\'"\-]+/g, "")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/\s+/g, "");
}

function detectBypassPatterns(content = "") {
  const normalized = normalizeBypassText(content);
  let score = 0;
  const hits = [];

  const bypassWords = [
    {
      regex: /(kurvaanyad|rohadjmeg|dogoljmeg|dogoljmeg|nyomorek|retkes|szarhazi|geci|csicska)/i,
      label: "Obfuszkált sértés",
    },
    {
      regex: /(discordgg|discordcominvite)/i,
      label: "Obfuszkált meghívó / reklám",
    },
    {
      regex: /(freenitro|giftlink|loginhere|token|steamajandek)/i,
      label: "Obfuszkált scam minta",
    },
  ];

  for (const item of bypassWords) {
    if (item.regex.test(normalized)) {
      hits.push(item.label);
      score += CONFIG.BYPASS_EXTRA_POINTS;
    }
  }

  if (/([a-záéíóöőúüű])\1{5,}/i.test(String(content || ""))) {
    hits.push("Széthúzott / ismételt karakteres megkerülés");
    score += 6;
  }

  return { score, hits, normalized };
}

function falsePositiveShield(message, ruleScan, contextMessages = [], replyTarget = null) {
  if (!CONFIG.FALSE_POSITIVE_SHIELD) {
    return { block: false, reason: "" };
  }

  const content = String(message?.content || "").trim();
  if (!content) return { block: true, reason: "Üres tartalom." };

  const lower = content.toLowerCase();
  const rawContext = JSON.stringify(contextMessages || []).toLowerCase();

  if (
    /^(mi ez|miért|hogy|hogyan|mit jelent|mit lehet tudni|mi az|ez mit jelent)/i.test(lower) &&
    ruleScan.score < 35
  ) {
    return { block: true, reason: "Valószínűleg kérdés vagy általános érdeklődés." };
  }

  if (
    /(^|\s)(szabály|szabályzat|tilos|nem szabad|report|ticket|admin|moderáció)($|\s)/i.test(lower) &&
    /("|„|”|'|`)/.test(content) &&
    ruleScan.score < 55
  ) {
    return { block: true, reason: "Valószínűleg idézet vagy szabálymagyarázat." };
  }

  if (
    /(?:idézem|quote|ezt írta|azt írta|mondta hogy|ezt mondta|azt mondta)/i.test(lower) &&
    ruleScan.score < 60
  ) {
    return { block: true, reason: "Idézett vagy visszaadott tartalom gyanú." };
  }

  if (
    /(nem mondtam|nem fenyegetés|nem komolyan|példa|csak példa|teszt|tesztelés)/i.test(lower) &&
    ruleScan.score < 30
  ) {
    return { block: true, reason: "Teszt / magyarázó / nem szó szerinti szöveg gyanú." };
  }

  if (
    replyTarget?.targetContent &&
    rawContext.includes("bocs") &&
    /(bocs|ne haragudj|sajnálom)/i.test(lower) &&
    ruleScan.score < 24
  ) {
    return { block: true, reason: "Valószínűleg békítő / konfliktuszáró üzenet." };
  }

  return { block: false, reason: "" };
}

function getBehaviorSignals({ profile, message, ruleScan, bypass, replyTarget }) {
  const recentCounts = getRecentIncidentCounts(profile);
  let score = 0;
  const labels = [];

  if (isWatchActive(profile)) {
    score += 8;
    labels.push("Aktív watch mód");
  }

  if ((replyTarget?.targetId || "") && replyTarget.targetId !== message.author?.id) {
    score += 4;
    labels.push("Valakire válaszul érkezett");
  }

  if (replyTarget?.targetIsStaff) {
    score += CONFIG.REPLY_TARGET_BONUS_POINTS;
    labels.push("Staff felé irányuló válasz");
  }

  if (recentCounts.serious7d >= 2) {
    score += 10;
    labels.push("Komoly előzmények 7 napon belül");
  }

  if (recentCounts.serious30d >= 4) {
    score += 12;
    labels.push("Komoly előzmények 30 napon belül");
  }

  if ((profile.totals?.timeouts || 0) >= 2) {
    score += 8;
    labels.push("Több korábbi timeout");
  }

  if ((profile.totals?.kicks || 0) >= 1) {
    score += 10;
    labels.push("Korábbi kick");
  }

  if (Number(bypass?.score || 0) > 0) {
    score += Number(bypass.score || 0);
    labels.push("Megkerülési / obfuszkálási minta");
  }

  if (ruleScan.hits.some((h) => ["flood", "spam"].includes(h.key))) {
    score += 4;
    labels.push("Spam jelleg");
  }

  return { score, labels };
}

function getEscalationTrend(profile) {
  const recent = [...(profile.incidents || [])]
    .filter((inc) => inc && inc.createdAt)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 6);

  if (recent.length < 2) return { level: 0, label: "nincs" };

  const map = { enyhe: 1, közepes: 2, magas: 3, kritikus: 4 };
  let trend = 0;

  for (let i = 0; i < recent.length - 1; i++) {
    trend += (map[recent[i].severity] || 0) - (map[recent[i + 1].severity] || 0);
  }

  const level = trend >= 4 ? 2 : trend >= 2 ? 1 : 0;
  const label = level === 2 ? "gyorsuló" : level === 1 ? "emelkedő" : "stabil";
  return { level, label };
}

function getDynamicTimeoutMinutes({
  severity,
  points,
  projectedRisk,
  suspicion,
  profile,
  safeMode,
}) {
  let minutes = Math.round(timeoutMsForSeverity(severity) / 60000);

  if (points >= 75) minutes += 45;
  if (points >= 90) minutes += 120;
  if (projectedRisk >= CONFIG.KICK_NEAR_THRESHOLD) minutes += 120;
  if (projectedRisk >= CONFIG.BAN_NEAR_THRESHOLD) minutes += 240;
  if (suspicion >= CONFIG.SUSPICION_TIMEOUT_THRESHOLD) minutes += 60;
  if ((profile.totals?.timeouts || 0) >= 2) minutes += 60;
  if (safeMode) minutes = Math.max(10, Math.round(minutes * 0.65));

  return Math.max(10, Math.min(1440, minutes));
}

function actionRank(action) {
  const map = {
    ignore: 0,
    watch: 1,
    warn: 2,
    delete: 3,
    timeout: 4,
    kick: 5,
    ban: 6,
    unban: 7,
  };
  return map[action] ?? 0;
}
function normalizeExclusiveAction(action) {
  const normalized = normalizeAction(action);

  // Egy user-facing notice legyen, ne warn + delete együtt
  if (["delete", "timeout", "kick", "ban", "unban"].includes(normalized)) {
    return normalized;
  }

  if (normalized === "warn") return "warn";
  if (normalized === "watch") return "watch";
  if (normalized === "ignore") return "ignore";

  return normalized;
}

function getNoticeTypeForAction(action) {
  switch (action) {
    case "warn":
      return "warn";
    case "watch":
      return "watch";
    case "delete":
      return "delete";
    default:
      return null;
  }
}

function shouldSendUserNotice(profile, action, message) {
  if (!profile.noticeState) {
    profile.noticeState = {
      lastNoticeAt: 0,
      lastNoticeAction: "",
      lastNoticeMessageId: null,
    };
  }

  const currentMessageId = message?.id || null;
  const lastMessageId = profile.noticeState.lastNoticeMessageId || null;

  // Ugyanarra a konkrét üzenetre ne küldje ki még egyszer
  if (currentMessageId && lastMessageId && currentMessageId === lastMessageId) {
    return false;
  }

  profile.noticeState.lastNoticeAt = Date.now();
  profile.noticeState.lastNoticeAction = action || "";
  profile.noticeState.lastNoticeMessageId = currentMessageId;

  return true;
}

async function sendSingleUserNotice({ message, member, profile, final }) {
  const noticeType = getNoticeTypeForAction(final.action);
  if (!noticeType) return;

  if (!shouldSendUserNotice(profile, noticeType, message)) {
    return;
  }

  if (noticeType === "warn") {
    await sendWarnNoticeInChannel(message, member, profile, final).catch(() => null);
    return;
  }

  if (noticeType === "watch") {
    await sendWatchNoticeInChannel(message, member, profile, final).catch(() => null);
    return;
  }

  if (noticeType === "delete") {
    await sendDeleteNoticeInChannel(message, member, profile, final).catch(() => null);
    return;
  }
}
function downgradeAction(action) {
  if (action === "ban") return "kick";
  if (action === "kick") return "timeout";
  if (action === "timeout") return "delete";
  if (action === "delete") return "warn";
  if (action === "warn") return "watch";
  return "ignore";
}

function capActionForSafeMode(action) {
  const maxRank = actionRank(CONFIG.SAFE_MODE_MAX_ACTION);
  let current = action;

  while (actionRank(current) > maxRank) {
    current = downgradeAction(current);
  }

  return current;
}

function summarizeIncidents(profile) {
  const counts = getRecentIncidentCounts(profile);
  const totals = profile.totals || {};
  return {
    seven: `Összes incidens: ${counts.last7d}\nKomoly incidens: ${counts.serious7d}`,
    thirty: `Összes incidens: ${counts.last30d}\nKomoly incidens: ${counts.serious30d}`,
    actions: `Warn: ${totals.warnings || 0}\nDelete: ${totals.deletions || 0}\nTimeout: ${totals.timeouts || 0}\nKick: ${totals.kicks || 0}\nBan: ${totals.bans || 0}\nUnban: ${totals.unbans || 0}`,
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

function buildRulesText() {
  return CONFIG.RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
}

function canModerateTarget(member) {
  if (!member?.guild?.members?.me) return false;
  const me = member.guild.members.me;
  if (member.id === me.id) return false;
  if (member.user?.bot) return false;
  return me.roles.highest.position > member.roles.highest.position;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return "{}";
  }

  return raw.slice(firstBrace, lastBrace + 1);
}

const REGEX = {
  invite: /(discord\.gg\/|discord\.com\/invite\/)/i,
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

const MILD_PROFANITY_WORDS = [
  "basszus", "basszuska", "basszameg", "bassza meg", "basszák meg", "basszad", "basszad meg", "basszátok", "basszátok meg",
  "baszki", "baszkik", "baszd", "baszd meg", "baszmeg", "bazdmeg", "bazmeg", "bmeg", "bakker", "franc", "francba", "francot",
  "a francba", "az istenit", "az istenit neki", "a mindenit", "a kurva", "akurva", "kurva", "kurvára", "kurvara", "kurva élet",
  "kurvaelet", "kurva életbe", "kurvaeletbe", "geci", "gecibe", "gecire", "gecis", "geciség", "geciseg",
  "fasz", "faszba", "faszom", "faszomat", "faszért", "faszert", "faszkivan", "fasz kivan", "tele van a faszom",
  "kivan a faszom", "teli van a faszom", "faszom kivan", "faszom tele van", "picsa", "picsába", "picsaba",
  "fasz se", "fasz tudja", "a fasz tudja", "ki a faszt", "mi a fasz", "mi a faszom", "hol a faszba", "mit a fasz",
  "szar", "szar ez", "szar az egész", "szar az egesz", "ez szar", "rohadt szar", "kurva szar", "fos", "fos ez",
  "fos az egész", "fos az egesz", "egy fos", "egy rakás szar", "egy rakas szar", "rakás fos", "rakas fos",
  "szopás", "szopas", "szívás", "szivas", "rohadjon meg", "rohadj meg", "a rohadt", "rohadt", "rohadék", "rohadek",
  "kapja be", "bekaphatja", "bekaphatod", "bekaphatjátok", "kapd be", "kapjátok be", "szopjál", "szopjal", "szopj",
  "idegbaj", "agyfasz", "agyf*sz", "agyfaszt kapok", "agyrém", "agyrem", "idegesít", "idegesit", "felbasz", "felbaszott",
  "felbaszod", "felbasz engem", "felidegesít", "felidegesit", "kikészít", "kikeszit", "elegem van", "nagyon elegem van",
  "hányadék", "hanyadek", "okádék", "okadek", "gusztustalan", "undorító", "undorito", "szenny", "szutyok", "mocsok"
];

const INSULT_WORDS = [
  "anyád", "anyad", "anyádat", "anyadat", "anyátok", "anyatok", "kurva anyád", "kurva anyad", "a kurva anyád", "a kurva anyad",
  "nyomorék", "nyomorek", "nyomorult", "nyomoronc", "retkes", "tetves", "mocskos", "rohadt", "rohadék", "rohadek", "rothadt",
  "idióta", "idiota", "hülye", "hulye", "hülyék", "hulyek", "ostoba", "barom", "barmok", "marha", "ökör", "okor", "balfasz",
  "balfék", "balfek", "balek", "agyhalott", "agyatlan", "gyökér", "gyoker", "kretén", "kreten", "debil", "degenerált", "degeneralt",
  "senkiházi", "senkihazi", "semmirekellő", "semmirekello", "haszontalan", "értéktelen", "ertektelen", "szánalmas", "szanalmas",
  "nevetséges", "nevetseges", "bohóc", "bohoc", "csicska", "patkány", "patkany", "féreg", "fereg", "tetű", "tetu", "csíra", "csira",
  "suttyó", "suttyo", "tapló", "taplo", "paraszt", "tahó", "taho", "bunkó", "bunko", "proli", "csöves", "csoves", "csóró", "csoro",
  "lúzer", "luzer", "vesztes", "alja", "aljadék", "aljadek", "hitvány", "hitvany", "gerinctelen", "sunyi", "hazug", "kamus",
  "képmutató", "kepmutato", "seggnyaló", "seggnyalo", "seggfej", "seggarc", "faszfej", "faszarc", "faszkalap", "faszláda", "faszlada",
  "faszparaszt", "faszszopó", "faszszopo", "gecifej", "geciarc", "gecizsák", "gecizsak", "geciláda", "gecilada", "szarfej", "szararc",
  "fosfej", "fosarc", "kutyafej", "kutyageci", "kutyafasz", "disznó", "diszno", "disznófej", "disznofej", "majom", "majomarc", "majomfej",
  "állat", "allat", "vadbarom", "szuka", "ribanc", "lotyó", "lotyo", "ringyó", "ringyo", "cafka", "fattyú", "fattyu", "korcs",
  "pszichopata", "elmebeteg", "őrült", "orult", "zakkant", "bolond", "undorító", "undorito", "gusztustalan", "hányadék", "hanyadek",
  "okádék", "okadek", "szutyok", "szenny", "mocsok", "retkes geci", "nyomorék geci", "nyomorek geci", "rohadt geci", "mocskos geci",
  "szánalmas gyökér", "szanalmas gyoker", "semmirekellő bohóc", "semmirekello bohoc", "bunkó fasz", "bunko fasz", "sötét fasz", "sotet fasz",
  "agyhalott geci", "retkes paraszt", "rohadt paraszt", "csicska fasz", "senkiházi geci", "senkihazi geci", "hulladék geci", "hulladek geci",
  "patkány geci", "patkany geci", "idióta fasz", "idiota fasz", "hülyepicsa", "hulyepicsa", "hülyefasz", "hulyefasz"
];

const TARGET_WORDS = [
  "szerver", "server", "internalgaming", "admin", "adminok", "adminisztrátor", "adminisztrator",
  "moderátor", "moderator", "moderátorok", "moderatorok", "staff", "vezetőség", "vezetoseg",
  "fejlesztő", "fejleszto", "fejlesztők", "fejlesztok", "közösség", "kozosseg", "játékos",
  "jatekos", "játékosok", "jatekosok", "csapat", "rendszer", "bot", "projekt"
];

const MILD_PROFANITY_PATTERNS = [
  /\b(bassz(?:us|a|ad|atok|átok|ad meg|a meg))\b/i,
  /\b(ba[sz]+d?me?g|baz+me?g|bmeg)\b/i,
  /\b(kurv+a|kurv+ára|kurv+ara|a\s*kurva)\b/i,
  /\b(gec+i|gec+ibe|gec+ire|gec+is)\b/i,
  /\b(fasz+|faszom|faszba|faszért|faszert)\b/i,
  /\b(pics+a|picsába|picsaba)\b/i,
  /\b(szar+|szaros)\b/i,
  /\b(fos+|fosadék|fosadek)\b/i,
  /\b(agyfasz|agyf\*?sz)\b/i,
  /\b(felbasz|felbaszott|felbaszod)\b/i,
  /\b(elegem\s+van|tele\s+van\s+a\s+faszom|kivan\s+a\s+faszom)\b/i,
];

const INSULT_PATTERNS = [
  /\b(kurva\s+anyád|kurva\s+anyad|a\s+kurva\s+anyád|a\s+kurva\s+anyad)\b/i,
  /\b(anyád|anyad|anyádat|anyadat|anyátok|anyatok)\b/i,
  /\b(nyomorék|nyomorek|retkes|tetves|mocskos|rohadék|rohadek|rohadt)\b/i,
  /\b(idióta|idiota|hülye|hulye|ostoba|barom|marha|ökör|okor|balfasz|balfék|balfek)\b/i,
  /\b(agyhalott|agyatlan|gyökér|gyoker|kretén|kreten|debil|degenerált|degeneralt)\b/i,
  /\b(senkiházi|senkihazi|semmirekellő|semmirekello|haszontalan|értéktelen|ertektelen)\b/i,
  /\b(szánalmas|szanalmas|nevetséges|nevetseges|bohóc|bohoc|csicska)\b/i,
  /\b(patkány|patkany|féreg|fereg|tetű|tetu|csíra|csira|suttyó|suttyo|tapló|taplo)\b/i,
  /\b(paraszt|tahó|taho|bunkó|bunko|proli|csöves|csoves|csóró|csoro|lúzer|luzer)\b/i,
  /\b(faszfej|faszarc|faszkalap|faszláda|faszlada|faszparaszt|faszszopó|faszszopo)\b/i,
  /\b(gecifej|geciarc|gecizsák|gecizsak|geciláda|gecilada|szarfej|szararc|fosfej|fosarc)\b/i,
  /\b(kutyafej|kutyageci|disznó|diszno|majom|majomarc|majomfej|állat|allat|vadbarom)\b/i,
  /\b(ribanc|lotyó|lotyo|ringyó|ringyo|cafka|fattyú|fattyu|korcs)\b/i,
  /\b(pszichopata|elmebeteg|őrült|orult|zakkant|bolond)\b/i,
  /\b(undorító|undorito|gusztustalan|hányadék|hanyadek|okádék|okadek|szutyok|szenny|mocsok)\b/i,
  /\b(dögölj\s+meg|dogolj\s+meg|rohadj\s+meg|pusztulj(\s+el)?)\b/i,
];

function containsFromWordList(content = "", words = []) {
  const lower = String(content || "").toLowerCase();
  return words.some((word) => lower.includes(word));
}

function matchesAnyPattern(content = "", patterns = []) {
  const text = String(content || "");
  return patterns.some((pattern) => pattern.test(text));
}

function includesAnyWord(text, words) {
  return words.some((word) => text.includes(word));
}

function isTargetedInsult(content) {
  const lower = String(content || "").toLowerCase();
  return containsInsultWord(lower) && containsTargetWord(lower);
}

function containsMildProfanity(content = "") {
  return (
    containsFromWordList(content, MILD_PROFANITY_WORDS) ||
    matchesAnyPattern(content, MILD_PROFANITY_PATTERNS)
  );
}

function containsInsultWord(content = "") {
  return (
    containsFromWordList(content, INSULT_WORDS) ||
    matchesAnyPattern(content, INSULT_PATTERNS)
  );
}

function containsTargetWord(content = "") {
  const lower = String(content || "").toLowerCase();
  return TARGET_WORDS.some((word) => lower.includes(word));
}

function isContextualProfanity(content = "") {
  const lower = String(content || "").toLowerCase().trim();

  if (!containsMildProfanity(lower) && !containsInsultWord(lower)) return false;
  if (containsTargetWord(lower)) return false;

  if (/(te\b|ti\b|neked\b|nektek\b|ő\b|ez a\b|olyan vagy\b|vagytok\b)/i.test(lower)) {
    return false;
  }

  return true;
}

function isTargetedDegradingMessage(content = "") {
  const lower = String(content || "").toLowerCase().trim();

  if (!containsInsultWord(lower) && !containsMildProfanity(lower)) return false;
  if (!containsTargetWord(lower)) return false;

  if (
    /\b(szerver|server|internalgaming|admin|adminok|moderátor|moderator|staff|vezetőség|vezetoseg|fejlesztő|fejleszto|közösség|kozosseg|játékos|jatekos)\b.{0,24}\b(szar|fos|retkes|bohóc|bohoc|szutyok|szenny|hulladék|hulladek|nyomorék|nyomorek|idióta|idiota|semmirekellő|semmirekello|geci|fasz)\b/i.test(lower) ||
    /\b(szar|fos|retkes|bohóc|bohoc|szutyok|szenny|hulladék|hulladek|nyomorék|nyomorek|idióta|idiota|semmirekellő|semmirekello|geci|fasz)\b.{0,24}\b(szerver|server|internalgaming|admin|adminok|moderátor|moderator|staff|vezetőség|vezetoseg|fejlesztő|fejleszto|közösség|kozosseg|játékos|jatekos)\b/i.test(lower)
  ) {
    return true;
  }

  return false;
}

function countRecentTargetedInsults(profile, currentContent = "") {
  const nowTs = Date.now();
  const normalized = String(currentContent || "").toLowerCase().trim();

  return (profile.recentMessages || []).filter((m) => {
    const sameWindow = nowTs - Number(m.createdAt || 0) <= 15 * 60 * 1000;
    if (!sameWindow) return false;

    const text = String(m.content || "").toLowerCase().trim();

    if (text === normalized) return true;
    if (isTargetedDegradingMessage(text)) return true;

    return false;
  }).length;
}

function isStrongDirectAbuse(content) {
  const lower = String(content || "").toLowerCase();
  return /(kurva any[aá]d|bazdmeg te|rohadj meg|dögölj meg|nyomorék geci|retkes szar)/i.test(lower);
}

async function getReplyTargetInfo(message) {
  try {
    if (!message?.reference?.messageId) {
      return {
        targetId: null,
        targetTag: "",
        targetIsStaff: false,
        targetContent: "",
      };
    }

    const replied = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    if (!replied) {
      return {
        targetId: null,
        targetTag: "",
        targetIsStaff: false,
        targetContent: "",
      };
    }

    let targetIsStaff = false;
    if (replied.member) {
      targetIsStaff = isStaff(replied.member);
    }

    return {
      targetId: replied.author?.id || null,
      targetTag: replied.author?.tag || replied.author?.username || "",
      targetIsStaff,
      targetContent: cleanText(replied.content || "", 240),
    };
  } catch {
    return {
      targetId: null,
      targetTag: "",
      targetIsStaff: false,
      targetContent: "",
    };
  }
}

function scanRules(message, recentSameUser = []) {
  const content = String(message.content || "");
  const lower = content.toLowerCase();

  const hits = [];
  let score = 0;

if (!content.trim()) return { hits, score };

if (isContextualProfanity(content)) {
  hits.push({
    key: "warn",
    points: 18,
    label: "Nyers, trágár megfogalmazás",
  });
  score += 18;
}

if (isTargetedDegradingMessage(content)) {
  hits.push({
    key: "targeted_degrading",
    points: 42,
    label: "Célzott obszcén minősítés / szidalmazás",
  });
  score += 42;
}

if (isTargetedDegradingMessage(content)) {
  hits.push({
    key: "targeted_degrading",
    points: 42,
    label: "Célzott obszcén minősítés / szidalmazás",
  });
  score += 42;
}
  if (REGEX.doxxing.test(content)) {
    hits.push({
      key: "doxxing",
      points: 80,
      label: "Privát adat / doxxing gyanú",
    });
    score += 80;
  }

  if (REGEX.threat.test(content)) {
    hits.push({
      key: "threat",
      points: 68,
      label: "Fenyegetés gyanú",
    });
    score += 68;
  }

  if (REGEX.scam.test(content)) {
    hits.push({
      key: "scam",
      points: 95,
      label: "Scam / átverés gyanú",
    });
    score += 95;
  }

  if (REGEX.vpnBanEvade.test(content)) {
    hits.push({
      key: "ban_evasion",
      points: 84,
      label: "VPN / ban evasion gyanú",
    });
    score += 84;
  }

  if (REGEX.adServer.test(content) || REGEX.invite.test(content)) {
    hits.push({
      key: "ad_server",
      points: 62,
      label: "Más szerver reklám / uszítás",
    });
    score += 62;
  }

  if (REGEX.nsfw.test(content)) {
    hits.push({
      key: "nsfw",
      points: 58,
      label: "NSFW / obszcén tartalom gyanú",
    });
    score += 58;
  }

  if (REGEX.politics.test(content)) {
    hits.push({
      key: "politics_sensitive",
      points: 22,
      label: "Tiltott érzékeny tartalom",
    });
    score += 22;
  }

  if (REGEX.staffAbuse.test(content)) {
    hits.push({
      key: "staff_abuse",
      points: 68,
      label: "Staff / szerver obszcén szidalmazása",
    });
    score += 68;
  } else if (isTargetedInsult(content)) {
    hits.push({
      key: "staff_abuse",
      points: 52,
      label: "Célzott minősítés / sértegetés",
    });
    score += 52;
  } else if (REGEX.harassment.test(content) || isStrongDirectAbuse(content)) {
    hits.push({
      key: "harassment",
      points: 44,
      label: "Célzott sértegetés / zaklatás gyanú",
    });
    score += 44;
  }

  const mentionCount = (content.match(REGEX.mentionAbuse) || []).length;
  if (mentionCount >= CONFIG.MASS_MENTION_COUNT) {
    hits.push({
      key: "spam",
      points: 20,
      label: "Indokolatlan tömeges tagelés",
    });
    score += 20;
  }

  const emojiCount = (content.match(REGEX.emoji) || []).length;
  if (emojiCount >= CONFIG.EMOJI_SPAM_THRESHOLD) {
    hits.push({
      key: "spam",
      points: 12,
      label: "Emoji / GIF spam gyanú",
    });
    score += 12;
  }

  if (REGEX.repeatChars.test(content)) {
    hits.push({
      key: "spam",
      points: 10,
      label: "Karakter spam",
    });
    score += 10;
  }

  if (content.length >= CONFIG.CAPS_MIN_LENGTH) {
    const letters = content.replace(/[^a-zA-ZÁÉÍÓÖŐÚÜŰáéíóöőúüű]/g, "");
    if (letters.length >= CONFIG.CAPS_MIN_LENGTH) {
      const upper = letters.replace(/[^A-ZÁÉÍÓÖŐÚÜŰ]/g, "").length;
      const ratio = upper / letters.length;

      if (ratio >= CONFIG.CAPS_RATIO_THRESHOLD) {
        hits.push({
          key: "spam",
          points: 12,
          label: "Caps spam",
        });
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
    hits.push({
      key: "flood",
      points: 26,
      label: "Ismételt ugyanaz az üzenet",
    });
    score += 26;
  }

  const recentWindow = recentSameUser.filter(
    (m) => now() - (m.createdAt || 0) <= CONFIG.FLOOD_WINDOW_MS
  ).length;

  if (recentWindow + 1 >= CONFIG.FLOOD_MESSAGE_COUNT) {
    hits.push({
      key: "flood",
      points: 30,
      label: "Flood / gyors üzenetáradat",
    });
    score += 30;
  }

  return { hits, score };
}

function shouldRunAi(ruleScore, content) {
  if (!content?.trim()) return false;

  const lower = content.toLowerCase();

  if (ruleScore >= 8) return true;
  if (isTargetedInsult(lower)) return true;
  if (isStrongDirectAbuse(lower)) return true;

  return (
    /(megöl|kinyírlak|megver|szétszedlek|elkaplak|megtalállak|megkereslek)/i.test(lower) ||
    /(paypal|revolut|p[eé]nz|p[eé]nzért|account|elad[oó]|gift link|token|login here|ingyen nitro|free nitro)/i.test(lower) ||
    /(discord\.gg|discord\.com\/invite|gyertek át|csatlakozzatok|jöjjetek át)/i.test(lower) ||
    /(telefonsz[aá]m|lakc[ií]m|facebook|instagram|ip cím|ip\b|priv[aá]t k[eé]p)/i.test(lower) ||
    /(porn[oó]|nsfw|meztelen|nudes?|szexk[eé]p)/i.test(lower)
  );
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
    suspicion = 0,
    feedbackDelta = 0,
    replyTarget = null,
    bypassHits = [],
    watchActive = false,
    escalationLabel = "nincs",
  } = payload;
  
if (!getState("aimod_enabled")) {
  return {
    category: "other",
    categoryHu: "Egyéb",
    severity: "enyhe",
    confidence: 0,
    points: 0,
    ruleBroken: "AI kikapcsolva",
    reason: "Az AI moderáció ki van kapcsolva.",
    analysis: "Az AI moderáció jelenleg nem aktív, csak alap szabályalapú rendszer fut.",
    patternSummary: "AI nem fut.",
    recommendedAction: "ignore",
    timeoutMinutes: 0,
    shouldNotifyStaff: false,
  };
}
  const prompt = `
Te egy emberi hangnemű, de fegyelmezett Discord moderációs AI vagy a(z) ${CONFIG.SERVER_NAME} szerveren.

Szabályok:
${buildRulesText()}

Felhasználó:
- username: ${username || "ismeretlen"}
- displayName: ${displayName || "ismeretlen"}
- jelenlegi kockázat: ${currentRisk}%
- jelenlegi gyanú / suspicion: ${suspicion}%
- staff feedback korrekció: ${feedbackDelta}
- watch mód aktív: ${watchActive ? "igen" : "nem"}
- eszkalációs trend: ${escalationLabel}
- előzmények összegzése: ${incidentSummary || "nincs"}

Szabályalapú találatok:
${JSON.stringify(ruleHits, null, 2)}

Kontextus:
${JSON.stringify(contextMessages, null, 2)}

Reply célpont:
${JSON.stringify(replyTarget || {}, null, 2)}

Megkerülési / obfuszkálási találatok:
${JSON.stringify(bypassHits || [], null, 2)}

Aktuális üzenet:
${messageContent}

Döntési elvek:
- Ne bannolj túl könnyen csak egyetlen enyhébb vagy kétértelmű mondat miatt.
- Ne büntess általános, ártalmatlan kérdéseket vagy hétköznapi beszélgetést.
- A célzott sértegetést, fenyegetést, scamet, reklámot, doxxingot és visszaeső spamet kezeld komolyan.
- Ban csak egyértelmű, súlyos vagy visszaeső esetben legyen.
- Delete / timeout / kick skálát használd emberien.
- Az "analysis" mező legyen max 3 teljes magyar mondat.
- A "patternSummary" rövid legyen.
- Csak JSON-t adj vissza.

{
  "category": "harassment | threat | staff_abuse | doxxing | nsfw | ad_server | spam | flood | ooc_trade | scam | ban_evasion | politics_sensitive | clean | other",
  "categoryHu": "Zaklatás / sértegetés",
  "severity": "enyhe | közepes | magas | kritikus",
  "confidence": 0,
  "points": 0,
  "ruleBroken": "rövid magyar szabály-megfogalmazás",
  "reason": "rövid magyar indoklás",
  "analysis": "max 3 mondatos emberi elemzés",
  "patternSummary": "rövid visszaesési összegzés",
  "recommendedAction": "ignore | watch | warn | delete | timeout | kick | ban",
  "timeoutMinutes": 0,
  "shouldNotifyStaff": true
}
`;

let response;

try {
  response = await openai.chat.completions.create({
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
} catch (error) {
  console.error("[AIMOD] OpenAI hiba:", error?.message || error);

  return {
    category: "other",
    categoryHu: "Egyéb",
    severity: "enyhe",
    confidence: 0,
    points: 0,
    ruleBroken: "AI hiba történt",
    reason: "Az AI válasz nem érhető el.",
    analysis: "Az AI kérés hibába futott, ezért fallback logika lett használva.",
    patternSummary: "AI elemzés nem futott le.",
    recommendedAction: "ignore",
    timeoutMinutes: 0,
    shouldNotifyStaff: false,
  };
}

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
      analysis:
        "Az automatikus elemzés nem tudott megbízható eredményt adni, ezért a rendszer szabályalapú fallback logikát használt. A tartalom ettől még problémás lehet, csak az AI válasza nem volt jól feldolgozható. Ilyenkor a rendszer óvatosabb, de a visszaeső mintákat továbbra is figyelembe veszi.",
      patternSummary: "Nem áll rendelkezésre biztos AI összegzés.",
      recommendedAction: "ignore",
      timeoutMinutes: 0,
      shouldNotifyStaff: false,
    };
  }
}

// =========================
// 🧠 USER ÜZENET GENERÁLÁS (AI + fallback)
// =========================

function getPlainUserFacingFallback(mode, staffText = "", context = "") {
  const note = cleanText(staffText || "", 220);

  if (note) return note;

  switch (mode) {
    case "delete_notice":
      return "Az üzenetedet a moderáció törölte. Kérlek figyelj jobban a szabályokra.";
    case "warn_notice":
      return "Figyelmeztetést kaptál. Kérlek figyelj jobban a kommunikációra.";
    case "watch_notice":
      return "A rendszer figyelmeztető jelzést adott az üzenetedre. Kérlek figyelj jobban a szabályokra.";
    case "apology":
      return "Elnézést kérünk, a moderáció ebben az esetben hibás döntést hozott.";
    case "unban":
      return "A korábbi korlátozásodat feloldottuk.";
    case "ban_notice":
      return "A fiókod szabályszegés miatt korlátozásra került.";
    default:
      return cleanText(context || "Moderációs értesítés.", 220);
  }
}

async function aiWriteUserFacingMessage({ mode, staffText = "", context = "" }) {
  const safeStaffText = cleanText(staffText || "", 700);
  const safeContext = cleanText(context || "", 1200);
  const fallback = getPlainUserFacingFallback(mode, safeStaffText, safeContext);

  // 🔴 AI KI KAPCSOLVA → fallback
  if (!getState("aimod_enabled")) {
    return fallback;
  }

  // 🔴 NINCS API / nincs előfizetés → fallback
  if (!process.env.OPENAI_API_KEY || String(process.env.OPENAI_API_KEY).includes("IDE_IRD")) {
    return fallback;
  }

  try {
    const prompt = `
Te egy Discord szerver természetes magyar üzenetírója vagy.

Feladat:
- írj rövid, emberi, normális hangnemű magyar szöveget
- ne legyél túl hivatalos
- ne írj aláírást
- ne használj felsorolást
- maximum 2 rövid mondat legyen
- ha a staff szövege üres, akkor magadtól írj korrekt rövid szöveget
- ha a staff szövege meg van adva, fogalmazd át természetesebbre
- ne írj olyat, hogy "Nincs megadva"
- csak a kész szöveget add vissza

Típus: ${mode}
Staff szöveg: ${safeStaffText || "nincs"}
Kontextus: ${safeContext || "nincs"}

Csak maga a szöveg legyen a válasz.
`;

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt,
      reasoning: { effort: "low" },
    });

    const text = cleanText(response.output_text || "", 260);
    if (!text) return fallback;

    return text;
  } catch (error) {
    console.error("[AIMOD] aiWriteUserFacingMessage hiba:", error?.message || error);
    return fallback;
  }
}

function pickHighestRuleHit(ruleHits) {
  if (!Array.isArray(ruleHits) || !ruleHits.length) return null;
  return [...ruleHits].sort((a, b) => (b.points || 0) - (a.points || 0))[0];
}

function finalDecision({
  profile,
  ruleScan,
  aiResult,
  bypass,
  replyTarget,
  shield,
  userId,
}) {
  const safeMode = getState("aimod_safe_mode");
  const currentRisk = getRiskPercent(profile);
  const suspicion = getSuspicionValue(profile);
  const severity = normalizeSeverityHu(aiResult.severity);
  const highestRule = pickHighestRuleHit(ruleScan.hits);
  const feedbackDelta = getFeedbackDelta(userId);
  const escalation = getEscalationTrend(profile);
  const behavior = getBehaviorSignals({
    profile,
    message: { author: { id: userId } },
    ruleScan,
    bypass,
    replyTarget,
  });

let points = Math.max(
  Number(aiResult.points || 0),
  Number(ruleScan.score || 0),
  Number(highestRule?.points || 0)
);

points += behavior.score;
points += feedbackDelta > 0 ? Math.round(feedbackDelta * 0.4) : 0;
points += escalation.level * 6;
if (replyTarget?.targetIsStaff) points += CONFIG.REPLY_TARGET_BONUS_POINTS;
if (suspicion >= CONFIG.SUSPICION_WARN_THRESHOLD) points += 6;
if (suspicion >= CONFIG.SUSPICION_TIMEOUT_THRESHOLD) points += 10;

const rehabScore = Number(profile.rehab?.score || 0);
if (rehabScore >= 20) points -= 4;
if (rehabScore >= 40) points -= 6;
if (rehabScore >= 60) points -= 8;
if (rehabScore >= 80) points -= 10;

points = Math.max(0, points);

  const recentCounts = getRecentIncidentCounts(profile);
  if (recentCounts.serious7d >= 2) points += 18;
  if (recentCounts.serious30d >= 4) points += 22;
  if ((profile.totals?.timeouts || 0) >= 2) points += 14;
  if ((profile.totals?.kicks || 0) >= 1) points += 24;

  let action = normalizeAction(aiResult.recommendedAction);
  action = normalizeAction(action);
action = normalizeExclusiveAction(action);
  let confidence = Number(aiResult.confidence || 0);

  const hasImmediateScam = ruleScan.hits.some((h) => h.key === "scam");
  const hasImmediateDox = ruleScan.hits.some((h) => h.key === "doxxing");
  const hasBanEvasion = ruleScan.hits.some((h) => h.key === "ban_evasion");
  const hasAdServer = ruleScan.hits.some((h) => h.key === "ad_server");
  const severe = ["magas", "kritikus"].includes(severity);

  if (shield?.block) {
    return {
      action: "ignore",
      severity: "enyhe",
      points: 0,
      confidence: 0,
      projectedRisk: currentRisk,
      category: "clean",
      categoryHu: "Nem problémás",
      ruleBroken: "False positive shield",
      reason: "A védőréteg szerint az üzenet valószínűleg nem büntetendő kontextusú.",
      analysis: "A rendszer false positive shield védelmet alkalmazott, ezért nem lépett automatikusan.",
      patternSummary: "A tartalom kontextus alapján valószínűleg nem büntetendő.",
      timeoutMinutes: 0,
      shouldNotifyStaff: false,
      moderationMode: safeMode ? "safe" : "balanced",
      shieldReason: shield.reason || "",
      bypassScore: Number(bypass?.score || 0),
      replyTarget:
        replyTarget?.targetTag ||
        (replyTarget?.targetId ? replyTarget.targetId : ""),
      suspicionGain: 0,
    };
  }

  if (safeMode) {
    points = Math.floor(points * CONFIG.SAFE_MODE_POINT_MULTIPLIER);
    confidence = Math.max(0, confidence - CONFIG.SAFE_MODE_CONFIDENCE_PENALTY);
    action = capActionForSafeMode(action);

    if ((hasImmediateScam || hasImmediateDox || hasBanEvasion) && confidence >= 90) {
      action = "timeout";
      points = Math.max(points, 78);
    }

    if (confidence < 70 && action === "timeout") action = "delete";
    if (confidence < 58 && ["delete", "warn", "watch"].includes(action)) action = "watch";
    if (confidence < 45) action = "ignore";
  } else {
    if (hasImmediateScam && confidence >= 70) {
      action = "ban";
      points = Math.max(points, 96);
    }

    if (hasImmediateDox && confidence >= 75) {
      action = "ban";
      points = Math.max(points, 94);
    }

    if (hasBanEvasion && confidence >= 75) {
      action = "ban";
      points = Math.max(points, 93);
    }

    if (hasAdServer && points >= 55 && action === "ignore") {
      action = "timeout";
    }
  }

  const suspicionGain =
    Number(bypass?.score || 0) > 0
      ? 10
      : ruleScan.score >= 25
        ? 6
        : action === "watch"
          ? 4
          : 0;

  let projectedRisk = Math.max(
    0,
    Math.min(100, currentRisk + Math.round(points * 0.38))
  );

  if (
    projectedRisk >= CONFIG.AUTO_BAN_READY_THRESHOLD &&
    severe &&
    confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_BAN &&
    (profile.totals?.kicks || 0) >= 1 &&
    !safeMode
  ) {
    action = "ban";
  } else if (
    projectedRisk >= CONFIG.BAN_NEAR_THRESHOLD &&
    severe &&
    confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_KICK &&
    !safeMode
  ) {
    action = "kick";
  } else if (
    projectedRisk >= CONFIG.KICK_NEAR_THRESHOLD &&
    ["ignore", "watch", "warn", "delete"].includes(action)
  ) {
    action = "timeout";
  }

  if (
    action === "kick" &&
    (profile.totals?.timeouts || 0) < 1 &&
    !hasImmediateScam &&
    !hasImmediateDox &&
    !hasBanEvasion
  ) {
    action = "timeout";
  }

  if (
    action === "ban" &&
    (profile.totals?.kicks || 0) < 1 &&
    !hasImmediateScam &&
    !hasImmediateDox &&
    !hasBanEvasion
  ) {
    action = "kick";
  }

  if (action === "ban" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_BAN) {
    action = "kick";
  }

  if (action === "kick" && confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_KICK) {
    action = "timeout";
  }

  if (
    action === "timeout" &&
    confidence < CONFIG.MIN_AI_CONFIDENCE_FOR_TIMEOUT &&
    projectedRisk < CONFIG.KICK_NEAR_THRESHOLD
  ) {
    action = "delete";
  }

  if (ruleScan.score >= 12 && action === "ignore") {
    action = "warn";
  }

  if (ruleScan.score >= 25 && ["ignore", "watch", "warn"].includes(action)) {
    action = "delete";
  }

  if (ruleScan.score >= 55 && ["ignore", "watch", "warn", "delete"].includes(action)) {
    action = "timeout";
  }

  if (
    recentCounts.serious7d >= 3 &&
    ["ignore", "watch", "warn", "delete"].includes(action)
  ) {
    action = "timeout";
  }

  if (
    recentCounts.serious30d >= 5 &&
    ["ignore", "watch", "warn", "delete", "timeout"].includes(action) &&
    !safeMode
  ) {
    action = "kick";
  }

  if (
    recentCounts.serious30d >= 7 &&
    (profile.totals?.timeouts || 0) >= 2 &&
    (profile.totals?.kicks || 0) >= 1 &&
    severe &&
    confidence >= CONFIG.MIN_AI_CONFIDENCE_FOR_BAN &&
    !safeMode
  ) {
    action = "ban";
  }

  if (safeMode) {
    action = capActionForSafeMode(action);
  }

  if (
    CONFIG.WATCH_MODE_ENABLED &&
    ["ignore", "warn"].includes(action) &&
    (suspicion + suspicionGain >= CONFIG.SUSPICION_WARN_THRESHOLD ||
      isWatchActive(profile) ||
      escalation.level >= 1)
  ) {
    action = "watch";
  }

  const timeoutMinutes = getDynamicTimeoutMinutes({
    severity,
    points,
    projectedRisk,
    suspicion: suspicion + suspicionGain,
    profile,
    safeMode,
  });

  return {
    action,
    severity,
    points,
    confidence,
    projectedRisk,
    category: aiResult.category || highestRule?.key || "other",
    categoryHu:
      aiResult.categoryHu ||
      categoryToHu(aiResult.category || highestRule?.key || "other"),
    ruleBroken:
      aiResult.ruleBroken || highestRule?.label || "Szabályszegés gyanú",
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
    timeoutMinutes,
    shouldNotifyStaff:
      Boolean(aiResult.shouldNotifyStaff) ||
      points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG ||
      ["watch", "timeout", "kick", "ban"].includes(action),
    moderationMode: safeMode ? "safe" : "balanced",
    shieldReason: shield?.reason || "",
    bypassScore: Number(bypass?.score || 0),
    replyTarget:
      replyTarget?.targetTag ||
      (replyTarget?.targetId ? replyTarget.targetId : ""),
    suspicionGain,
    feedbackDelta,
    escalationLabel: escalation.label,
    behaviorLabels: behavior.labels,
  };
}

function setActiveCase(profile, patch) {
  profile.activeCase = {
    ...profile.activeCase,
    ...patch,
    lastUpdatedAt: Date.now(),
  };
}

function getRiskBand(profile) {
  const risk = getRiskPercent(profile);

  if (risk >= CONFIG.BAN_NEAR_THRESHOLD) return "Nagyon magas";
  if (risk >= CONFIG.KICK_NEAR_THRESHOLD) return "Magas";
  if (risk >= CONFIG.HIGH_RISK_THRESHOLD) return "Emelkedett";
  if (risk >= CONFIG.WATCH_THRESHOLD) return "Figyelt";
  return "Alacsony";
}

function getExpectedSanction(profile) {
  const risk = getRiskPercent(profile);

  if (risk >= CONFIG.BAN_NEAR_THRESHOLD) {
    return "A következő komoly szabálysértésnél ban is jöhet.";
  }
  if (risk >= CONFIG.KICK_NEAR_THRESHOLD) {
    return "A következő súlyosabb szabálysértésnél kick vagy hosszabb timeout várható.";
  }
  if (risk >= CONFIG.HIGH_RISK_THRESHOLD) {
    return "A következő problémás üzenetnél timeout valószínű.";
  }
  if (risk >= CONFIG.WATCH_THRESHOLD) {
    return "A rendszer figyel, a következő problémás üzenetnél törlés vagy timeout is jöhet.";
  }
  return "Jelenleg enyhébb figyelmeztető szintben van a rendszer.";
}

function buildUnifiedEmbed({ member, profile }) {
  const currentRisk = getRiskPercent(profile);
  const suspicion = getSuspicionValue(profile);
  const summaries = summarizeIncidents(profile);
  const previousMessages = getPreviousProblemMessages(
    profile,
    profile.activeCase?.lastMessageId || null
  );
  const repeated =
    (profile.totals?.timeouts || 0) > 0 ||
    (profile.totals?.kicks || 0) > 0 ||
    (profile.incidents?.length || 0) >= 3;

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
        name: "📜 Szabály / indok",
        value:
          `Szabály: **${trimField(active.lastRuleBroken || "-", 256)}**\n` +
          `Indok: **${trimField(active.lastReason || "-", 256)}**`,
        inline: false,
      },
      {
        name: "📎 Bizonyíték",
        value:
          `Utolsó üzenet: ${trimField(active.lastMessageContent || "-", 256)}\n` +
          `Csatorna: ${active.lastChannelId ? `<#${active.lastChannelId}>` : "-"}\n` +
          `Részletek: ${trimField(active.lastEvidence || "-", 256)}`,
        inline: false,
      },
      {
        name: "📊 Kockázat",
        value: formatRiskBlock(profile),
        inline: true,
      },
      {
        name: "🕵️ Suspicion",
        value: `**${suspicion}%**`,
        inline: true,
      },
      {
        name: "⏭️ Várható következő lépés",
        value: trimField(getExpectedSanction(profile), 1024),
        inline: false,
      },
      {
        name: "📚 Előzmények (7 / 30 nap)",
        value: `${summaries.seven}\n\n${summaries.thirty}`,
        inline: true,
      },
      {
        name: "📦 Összes intézkedés",
        value: trimField(summaries.actions, 1024),
        inline: true,
      },
      {
        name: "🧾 Korábbi problémás üzenetek",
        value: trimField(previousMessages, 1024),
        inline: false,
      },
      {
  name: "🟢 Rehab állapot",
  value: trimField(getRehabDisplay(profile), 1024),
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

function shouldShowButtons(action) {
  return ["watch", "timeout", "kick", "ban", "unban", "delete"].includes(action);
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
        .setLabel("Bocsánatkérés")
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

async function resendUnifiedCaseMessage(client, member, profile) {
  const logChannel = await getLogChannel(client);
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

  const msg = await logChannel
    .send({
      embeds: [embed],
      components,
    })
    .catch(() => null);

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
    if (!getState("aimod_allow_timeout")) {
      console.log("[AIMOD] timeout tiltva a panelben");
      return false;
    }

    if (!member?.moderatable) {
      console.log("[AIMOD] member nem moderálható:", member?.user?.tag || member?.id);
      return false;
    }

    const ms = Math.max(60_000, Number(minutes || 1) * 60_000);
    await member.timeout(ms, reason);
    console.log("[AIMOD] timeout sikeres:", member?.user?.tag || member?.id, minutes);
    return true;
  } catch (error) {
    console.error("[AIMOD] timeout hiba:", error);
    return false;
  }
}

async function safeKick(member, reason) {
  try {
    if (!getState("aimod_allow_kick")) return false;
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
    if (!getState("aimod_allow_ban")) return false;
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
    context:
      "Az automatikus moderáció téves döntést hozott, ezért a felhasználó bocsánatkérő üzenetet kap.",
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

async function rewriteManualMuteReason(originalReason, minutes, moderatorTag) {
  const fallback = cleanText(originalReason || "Szabálysértés miatt ideiglenes némítást kaptál.", 300);

  if (!openai || !process.env.OPENAI_API_KEY) {
    return fallback;
  }

  try {
    const response = await openai.responses.create({
      model: CONFIG.AI_MODEL,
      input: `
Te egy Discord moderációs rendszer rövid magyar válaszgenerátora vagy.

Feladat:
- az alábbi staff indokot írd át rövid, normális, emberi hangvételű szöveggé
- ne legyen túl hivatalos
- ne legyen fenyegető
- 1-2 mondat legyen
- maradjon egyértelmű, hogy miért kapott timeoutot
- ne használj felsorolást

Időtartam: ${minutes} perc
Staff: ${moderatorTag}
Eredeti indok: ${fallback}

Csak a kész magyar szöveget add vissza.
      `,
      reasoning: { effort: "low" },
    });

    const text = cleanText(response.output_text || "", 350);
    return text || fallback;
  } catch (error) {
    console.error("[AIMOD] manual mute reason rewrite hiba:", error?.message || error);
    return fallback;
  }
}

async function sendAiTimeoutDM(user, final, member, message, profile) {
  const timeoutMinutes =
    Number(final.timeoutMinutes || 0) > 0
      ? Number(final.timeoutMinutes)
      : Math.max(1, Math.round(timeoutMsForSeverity(final.severity) / 60000));

  const text = await aiWriteUserFacingMessage({
    mode: "timeout_notice",
    context:
      `A felhasználó AI moderáció által timeoutot kapott. ` +
      `Időtartam: ${timeoutMinutes} perc. ` +
      `Szabály: ${final.ruleBroken}. ` +
      `Indok: ${final.reason}. ` +
      `Kockázat: ${getRiskPercent(profile)}%.`,
  });

  const embed = new EmbedBuilder()
    .setColor(colorBySeverity(final.severity))
    .setTitle("🔇 Időkorlátozás / Timeout")
    .setDescription(text)
    .addFields(
      {
        name: "⏱️ Időtartam",
        value: `**${timeoutMinutes} perc**`,
        inline: true,
      },
      {
        name: "📊 Jelenlegi kockázat",
        value: formatRiskBlock(profile),
        inline: true,
      },
      {
  name: "🟢 Profil állapot",
  value: trimField(getRehabDisplay(profile), 1024),
  inline: false,
},
      {
        name: "⏭️ Mire számíthatsz?",
        value: trimField(getExpectedSanction(profile), 1024),
        inline: false,
      },
      {
        name: "📜 Megszegett szabály",
        value: trimField(final.ruleBroken, 1024),
        inline: false,
      },
      {
        name: "🧾 Indoklás",
        value: trimField(final.reason, 1024),
        inline: false,
      },
      {
        name: "📎 Bizonyíték",
        value: trimField(
          `Üzenet: "${cleanText(message?.content || "", 220)}"\nCsatorna: #${
            message?.channel?.name || "ismeretlen"
          }\nFelhasználó: ${
            member?.user?.tag || member?.user?.username || "ismeretlen"
          }`,
          1024
        ),
        inline: false,
      }
    )
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());

  return notifyUserDM(user, embed);
}

async function sendManualMuteDM(user, { minutes, moderatorTag, originalReason, aiReason, profile, member = null }) {
  const text = await aiWriteUserFacingMessage({
    mode: "timeout_notice",
    staffText: aiReason || originalReason,
    context:
      `A felhasználó kézi staff mute-ot kapott. ` +
      `Időtartam: ${minutes} perc. ` +
      `Végrehajtotta: ${moderatorTag}. ` +
      `Eredeti staff indok: ${originalReason}.`,
  });

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("🔇 Némítás / Timeout")
    .setDescription(text)
    .addFields(
      {
        name: "⏱️ Időtartam",
        value: `**${minutes} perc**`,
        inline: true,
      },
      {
        name: "👮 Kiosztotta",
        value: moderatorTag || "Staff",
        inline: true,
      },
      {
        name: "📊 Jelenlegi kockázat",
        value: formatRiskBlock(profile),
        inline: false,
      },
      {
        name: "⏭️ Mire számíthatsz?",
        value: trimField(getExpectedSanction(profile), 1024),
        inline: false,
      },
      {
        name: "📜 Intézkedés oka",
        value: trimField(aiReason || originalReason || "Nincs megadva", 1024),
        inline: false,
      },
      {
        name: "📎 Bizonyíték / háttér",
        value: trimField(
          `Kézi staff intézkedés történt.${member?.user?.tag ? `\nFelhasználó: ${member.user.tag}` : ""}\nEredeti indok: ${originalReason}`,
          1024
        ),
        inline: false,
      }
    )
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());

  return notifyUserDM(user, embed);
}

async function sendKickDM(user, final, member, message, profile) {
  const text = await aiWriteUserFacingMessage({
    mode: "kick_notice",
    context:
      `A felhasználó AI moderáció által kicket kapott. ` +
      `Szabály: ${final.ruleBroken}. ` +
      `Indok: ${final.reason}. ` +
      `Kockázat: ${getRiskPercent(profile)}%.`,
  });

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("👢 Kirúgás / Kick")
    .setDescription(text)
    .addFields(
      {
        name: "📊 Jelenlegi kockázat",
        value: `**${getRiskPercent(profile)}%** (${getRiskBand(profile)})`,
        inline: true,
      },
      {
        name: "⏭️ Mire számíthatsz?",
        value: trimField(getExpectedSanction(profile), 1024),
        inline: true,
      },
      {
        name: "📜 Megszegett szabály",
        value: trimField(final.ruleBroken, 1024),
        inline: false,
      },
      {
        name: "🧾 Indoklás",
        value: trimField(final.reason, 1024),
        inline: false,
      },
      {
        name: "📎 Bizonyíték",
        value: trimField(
          `Üzenet: "${cleanText(message?.content || "", 220)}"\nCsatorna: #${
            message?.channel?.name || "ismeretlen"
          }\nFelhasználó: ${
            member?.user?.tag || member?.user?.username || "ismeretlen"
          }`,
          1024
        ),
        inline: false,
      }
    )
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());

  return notifyUserDM(user, embed);
}

async function sendBanDM(user, final, member, message, profile) {
  const text = await aiWriteUserFacingMessage({
    mode: "ban_notice",
    context: `A felhasználó AI moderáció által bannt kapott. Szabály: ${final.ruleBroken}. Indok: ${final.reason}.`,
  });

  const embed = new EmbedBuilder()
    .setColor(0xaa0000)
    .setTitle("🔨 Kitiltás")
    .setDescription(text)
    .addFields(
      {
        name: "📊 Jelenlegi kockázat",
        value: formatRiskBlock(profile),
        inline: false,
      },
      {
        name: "⏭️ Mi várható később?",
        value: trimField(getExpectedSanction(profile), 1024),
        inline: false,
      },
      {
        name: "📜 Megszegett szabály",
        value: trimField(final.ruleBroken, 1024),
        inline: false,
      },
      {
        name: "🧾 Indoklás",
        value: trimField(final.reason, 1024),
        inline: false,
      },
      {
        name: "📎 Bizonyíték",
        value: trimField(
          `Üzenet: "${cleanText(message?.content || "", 220)}"\nCsatorna: #${
            message?.channel?.name || "ismeretlen"
          }\nFelhasználó: ${
            member?.user?.tag || member?.user?.username || "ismeretlen"
          }`,
          1024
        ),
        inline: false,
      }
    )
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date());

  return notifyUserDM(user, embed);
}

async function sendDeleteNoticeInChannel(message, member, profile, final) {
  if (!getState("aimod_allow_delete_notice")) return;

  try {
    const noticeText = await aiWriteUserFacingMessage({
      mode: "delete_notice",
      context: `Az üzenet törölve lett. Szabály: ${final.ruleBroken}. Indok: ${final.reason}. Kockázat: ${getRiskPercent(profile)}%.`,
    });

    const embed = new EmbedBuilder()
      .setColor(colorBySeverity(final.severity))
      .setTitle("⚠️ AI moderációs értesítés")
      .setDescription(noticeText)
      .addFields(
        {
          name: "📜 Indok",
          value: trimField(final.reason, 1024),
          inline: false,
        },
        {
          name: "📊 Kockázati szint",
          value: formatRiskBlock(profile),
          inline: true,
        },
        {
          name: "⏭️ Mi várható később?",
          value: trimField(getExpectedSanction(profile), 1024),
          inline: true,
        }
      )
      .setFooter({
        text: `${CONFIG.SERVER_NAME} • Ez az értesítés rövid idő múlva törlődik`,
      })
      .setTimestamp(new Date());

    const sent = await message.channel
      .send({
        content: `${safeMentionUser(member.id)} \u200b`,
        allowedMentions: { users: [member.id] },
        embeds: [embed],
      })
      .catch(() => null);

    if (sent) {
      setTimeout(() => {
        sent.delete().catch(() => null);
      }, CONFIG.DELETE_NOTICE_TTL_MS);
    }
  } catch (error) {
    console.error("[AIMOD] delete notice hiba:", error);
  }
}

async function sendWarnNoticeInChannel(message, member, profile, final) {
  if (!getState("aimod_allow_delete_notice")) return;

  try {
    const noticeText = await aiWriteUserFacingMessage({
      mode: "warn_notice",
      context: `A felhasználó figyelmeztetést kapott. Szabály: ${final.ruleBroken}. Indok: ${final.reason}.`,
    });

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("⚠️ Figyelmeztetés")
      .setDescription(noticeText)
      .addFields(
        {
          name: "📜 Miért kaptad?",
          value: trimField(final.reason, 1024),
          inline: false,
        },
        {
          name: "📎 Bizonyíték",
          value: trimField(
            `Üzenet: "${cleanText(message?.content || "", 220)}"\nSzabály: ${final.ruleBroken}`,
            1024
          ),
          inline: false,
        },
        {
          name: "📊 Kockázati szint",
          value: formatRiskBlock(profile),
          inline: true,
        },
        {
          name: "⏭️ Mi várható később?",
          value: trimField(getExpectedSanction(profile), 1024),
          inline: true,
        }
      )
      .setFooter({
        text: `${CONFIG.SERVER_NAME} • Ez az értesítés rövid idő múlva törlődik`,
      })
      .setTimestamp(new Date());

    const sent = await message.channel
      .send({
        content: `${safeMentionUser(member.id)} \u200b`,
        allowedMentions: { users: [member.id] },
        embeds: [embed],
      })
      .catch(() => null);

    if (sent) {
      setTimeout(() => {
        sent.delete().catch(() => null);
      }, CONFIG.DELETE_NOTICE_TTL_MS);
    }
  } catch (error) {
    console.error("[AIMOD] warn notice hiba:", error);
  }
}

async function sendWatchNoticeInChannel(message, member, profile, final) {
  if (!getState("aimod_allow_delete_notice")) return;

  try {
    const noticeText = await aiWriteUserFacingMessage({
      mode: "watch_notice",
      context: `A felhasználó watch módba került. Szabály: ${final.ruleBroken}. Indok: ${final.reason}.`,
    });

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("👁️ Megfigyelési figyelmeztetés")
      .setDescription(noticeText)
      .addFields(
        {
          name: "📜 Indok",
          value: trimField(final.reason, 1024),
          inline: false,
        },
        {
          name: "📊 Kockázat / suspicion",
          value:
            `${formatRiskBlock(profile)}\n` +
            `Suspicion: **${getSuspicionValue(profile)}%**`,
          inline: true,
        }
      )
      .setFooter({
        text: `${CONFIG.SERVER_NAME} • Ez az értesítés rövid idő múlva törlődik`,
      })
      .setTimestamp(new Date());

    const sent = await message.channel
      .send({
        content: `${safeMentionUser(member.id)} \u200b`,
        allowedMentions: { users: [member.id] },
        embeds: [embed],
      })
      .catch(() => null);

    if (sent) {
      setTimeout(() => {
        sent.delete().catch(() => null);
      }, CONFIG.DELETE_NOTICE_TTL_MS);
    }
  } catch (error) {
    console.error("[AIMOD] watch notice hiba:", error);
  }
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

async function handleButtonLabelSwap(interaction, newLabel) {
  const updated = updateSingleButtonState(
    interaction.message.components,
    interaction.customId,
    newLabel
  );
  await interaction.update({ components: updated });
}

function reduceRiskAfterUnban(profile) {
  const removable = CONFIG.UNBAN_REMOVE_LAST_INCIDENTS;

  if (Array.isArray(profile.incidents) && profile.incidents.length > 0) {
    profile.incidents = profile.incidents.slice(
      0,
      Math.max(0, profile.incidents.length - removable)
    );
  }

  if (profile.totals?.bans > 0) {
    profile.totals.bans -= 1;
  }

  profile.totals.unbans = (profile.totals.unbans || 0) + 1;
  profile.totals.forgiveness = (profile.totals.forgiveness || 0) + 1;
  profile.suspicion = Math.max(
    0,
    Number(profile.suspicion || 0) - CONFIG.UNBAN_RISK_RELIEF_POINTS
  );
  profile.watchUntil = 0;
}

async function applyDecision({
  client,
  message,
  member,
  profile,
  final,
}) {
  const reasonText = cleanText(
    `${CONFIG.SERVER_NAME} AI moderáció • ${final.ruleBroken} • ${final.reason}`,
    500
  );

  let performed = false;


if (final.action === "timeout") {
  if (message?.deletable) {
    await safeDeleteMessage(message).catch(() => null);
    profile.totals.deletions = (profile.totals.deletions || 0) + 1;
  }

  const timeoutMinutes =
    Number(final.timeoutMinutes || 0) > 0
      ? Number(final.timeoutMinutes)
      : getDynamicTimeoutMinutes({
          severity: final.severity,
          points: final.points,
          projectedRisk: final.projectedRisk,
          suspicion: getSuspicionValue(profile),
          profile,
          safeMode: getState("aimod_safe_mode"),
        });

  const dmSent = await sendAiTimeoutDM(
    member.user,
    { ...final, timeoutMinutes },
    member,
    message,
    profile
  ).catch(() => false);

  const ok = await safeTimeout(member, timeoutMinutes, reasonText);

  if (ok) {
    profile.totals.timeouts = (profile.totals.timeouts || 0) + 1;
    profile.suspicion = Math.max(
      0,
      Number(profile.suspicion || 0) + Number(final.suspicionGain || 0)
    );

    console.log(
      `[AIMOD] Timeout DM állapot ${member.user?.tag || member.id}: ${dmSent ? "elküldve" : "nem sikerült"}`
    );

    performed = true;
  }
}

  if (final.action === "kick") {
    if (message?.deletable) {
      await safeDeleteMessage(message).catch(() => null);
      profile.totals.deletions = (profile.totals.deletions || 0) + 1;
    }

    const ok = await safeKick(member, reasonText);
    if (ok) {
      profile.totals.kicks = (profile.totals.kicks || 0) + 1;
      profile.suspicion = Math.max(
        0,
        Number(profile.suspicion || 0) + Number(final.suspicionGain || 0) + 10
      );
      performed = true;
    }
  }

if (final.action === "ban") {
  if (message?.deletable) {
    await safeDeleteMessage(message).catch(() => null);
    profile.totals.deletions = (profile.totals.deletions || 0) + 1;
  }

const dmSent = await sendBanDM(member.user, final, member, message, profile).catch(() => false);

  const ok = await safeBan(member, reasonText, 0);
  if (ok) {
    profile.totals.bans = (profile.totals.bans || 0) + 1;
    profile.suspicion = Math.max(
      0,
      Number(profile.suspicion || 0) + Number(final.suspicionGain || 0) + 16
    );

    console.log(
      `[AIMOD] Ban DM állapot ${member.user?.tag || member.id}: ${dmSent ? "elküldve" : "nem sikerült"}`
    );
    performed = true;
  }
}
if (performed) {
  await sendSingleUserNotice({
    message,
    member,
    profile,
    final,
  });
}

return performed;
}

async function processMessage(client, message) {
  try {
  if (!getState("aimod_enabled")) return;
  if (shouldIgnoreMessage(message)) return;

    const member =
      message.member ||
      (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;
    if (!canModerateTarget(member)) return;

    const profile = getUserProfile(member.id);
    pushRecentMessage(member.id, message);

    const recentSameUser = profile.recentMessages.filter(
      (m) => m.id !== message.id
    );

    const ruleScan = scanRules(message, recentSameUser);
    const replyTarget = await getReplyTargetInfo(message);
    const bypass = detectBypassPatterns(message.content || "");

    const contextMessages = recentSameUser
      .slice(-CONFIG.MAX_CONTEXT_MESSAGES)
      .map((m) => ({
        content: m.content,
        createdAt: m.createdAt,
        channelId: m.channelId,
      }));

    const shield = falsePositiveShield(message, ruleScan, contextMessages, replyTarget);

    if (shield.block) {
      profile.totals.shields = (profile.totals.shields || 0) + 1;
      setActiveCase(profile, {
        lastAction: "Védve / kihagyva",
        lastActionRaw: "ignore",
        lastReason: shield.reason,
        lastCategory: "False positive shield",
        lastSeverity: "enyhe",
        lastAnalysis:
          "A false positive shield védőréteg megfogta az üzenetet, ezért nem indult automatikus büntetés.",
        lastPatternSummary: "Nem büntetett kontextus / idézet / kérdés gyanú.",
        lastRuleBroken: "False positive shield",
        lastMessageContent: cleanText(message.content || "", 1000),
        lastMessageId: message.id,
        lastChannelId: message.channelId,
        lastProjectedRisk: getRiskPercent(profile),
        lastEvidence: `Shield indok: ${shield.reason}`,
        lastModerationMode: getModerationMode(),
        lastShieldReason: shield.reason,
        lastBypassScore: Number(bypass.score || 0),
        lastReplyTarget:
          replyTarget.targetTag ||
          (replyTarget.targetId ? replyTarget.targetId : ""),
        currentStatus: "Védett / kihagyott",
      });

      saveStore();
      if (Number(ruleScan.score || 0) >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG) {
        await resendUnifiedCaseMessage(client, member, profile).catch(() => null);
      }
      return;
    }

    let aiResult = {
      category: "other",
      categoryHu: "Egyéb szabálysértés",
      severity: "enyhe",
      confidence: 20,
      points: 0,
      ruleBroken: "",
      reason: "",
      analysis: "",
      patternSummary: "",
      recommendedAction: "ignore",
      timeoutMinutes: 0,
      shouldNotifyStaff: false,
    };

    if (shouldRunAi(ruleScan.score + bypass.score, message.content || "")) {
      aiResult = await aiAnalyzeModeration({
        messageContent: cleanText(message.content || "", 1500),
        contextMessages,
        ruleHits: ruleScan.hits,
        currentRisk: getRiskPercent(profile),
        incidentSummary: JSON.stringify(summarizeIncidents(profile)),
        username: message.author?.username || "",
        displayName: member.displayName || "",
        suspicion: getSuspicionValue(profile),
        feedbackDelta: getFeedbackDelta(member.id),
        replyTarget,
        bypassHits: bypass.hits,
        watchActive: isWatchActive(profile),
        escalationLabel: getEscalationTrend(profile).label,
      });
    } else if (ruleScan.score > 0) {
      aiResult = {
        category: highestCategoryFromRule(ruleScan.hits),
        categoryHu: categoryToHu(highestCategoryFromRule(ruleScan.hits)),
        severity: ruleScan.score >= 70 ? "magas" : ruleScan.score >= 35 ? "közepes" : "enyhe",
        confidence: Math.min(95, 35 + ruleScan.score),
        points: ruleScan.score,
        ruleBroken: pickHighestRuleHit(ruleScan.hits)?.label || "Szabályszegés gyanú",
        reason: "A szabályalapú ellenőrzés problémás mintát talált.",
        analysis: "A rendszer AI nélkül is egyértelmű szabálytalansági mintát talált a tartalomban.",
        patternSummary: "Szabályalapú minta alapján detektált tartalom.",
        recommendedAction:
          ruleScan.score >= 65 ? "timeout" : ruleScan.score >= 25 ? "delete" : "warn",
        timeoutMinutes: 0,
        shouldNotifyStaff: ruleScan.score >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG,
      };
    } else {
      return;
    }
  if (isTargetedDegradingMessage(message.content)) {
 const repeatCount = countRecentTargetedInsults(profile, message.content || "");

if (isTargetedDegradingMessage(message.content || "")) {
  let forcedAction = "delete";
  let severity = "enyhe";
  let points = 42;
  let suspicionGain = 8;

  if (repeatCount >= 1) {
    forcedAction = "delete";
    severity = "közepes";
    points = 50;
    suspicionGain = 12;
  }

  if (repeatCount >= 2) {
    forcedAction = "warn";
    severity = "közepes";
    points = 56;
    suspicionGain = 15;
  }

  if (repeatCount >= 3) {
    forcedAction = "timeout";
    severity = "közepes";
    points = 68;
    suspicionGain = 18;
  }

  if (repeatCount >= 5) {
    forcedAction = "kick";
    severity = "magas";
    points = 82;
    suspicionGain = 24;
  }

  if (repeatCount >= 7) {
    forcedAction = "ban";
    severity = "kritikus";
    points = 96;
    suspicionGain = 30;
  }

  const timeoutMinutes =
    forcedAction === "timeout"
      ? getDynamicTimeoutMinutes({
          severity,
          points,
          projectedRisk: getRiskPercent(profile),
          suspicion: getSuspicionValue(profile),
          profile,
          safeMode: getState("aimod_safe_mode"),
        })
      : 0;

  const final = {
    action: normalizeExclusiveAction(forcedAction),
    category: "staff_abuse",
    categoryHu: "Célzott szidalmazás / minősítés",
    severity,
    confidence: 92,
    points,
    projectedRisk: getRiskPercent(profile),
    suspicionGain,
    ruleBroken: "Célzott obszcén minősítés vagy szidalmazás.",
    reason: "A rendszer célzott, sértő minősítést talált valakire vagy valamire.",
    analysis:
      repeatCount >= 2
        ? "A felhasználó ismétlődően célzott obszcén minősítést használ."
        : "A felhasználó célzott obszcén minősítést használt.",
    patternSummary:
      repeatCount >= 1
        ? `Ismétlődő célzott minősítés (${repeatCount + 1}. eset rövid időn belül).`
        : "Egyszeri célzott minősítés.",
    shouldNotifyStaff: true,
    moderationMode: getModerationMode(),
    shieldReason: "",
    bypassScore: 0,
    replyTarget: "",
    timeoutMinutes,
  };
}

    const performed = await applyDecision({
      client,
      message,
      member,
      profile,
      final,
    });

    if (!performed) return;

    addIncident(member.id, {
      type: final.action,
      createdAt: now(),
      points: final.points,
      suspicion: final.suspicionGain,
      severity: final.severity,
      category: final.category,
      content: cleanText(message.content || "", 500),
      messageId: message.id,
      channelId: message.channelId,
      confidence: final.confidence,
      moderationMode: final.moderationMode,
    });

    saveStore();
    await resendUnifiedCaseMessage(client, member, profile).catch(() => null);
    return;
  }

if (!isTargetedDegradingMessage(message.content || "") && isContextualProfanity(message.content || "")) {
  const mildRepeatCount = (profile.recentMessages || []).filter((m) => {
    const sameWindow = Date.now() - Number(m.createdAt || 0) <= 10 * 60 * 1000;
    if (!sameWindow) return false;
    return isContextualProfanity(m.content || "");
  }).length;

  let forcedAction = "warn";
  let severity = "enyhe";
  let points = 18;
  let suspicionGain = 4;

  if (mildRepeatCount >= 2) {
    forcedAction = "delete";
    points = 26;
    suspicionGain = 8;
  }

  if (mildRepeatCount >= 4) {
    forcedAction = "timeout";
    severity = "közepes";
    points = 42;
    suspicionGain = 12;
  }

  const timeoutMinutes =
    forcedAction === "timeout"
      ? getDynamicTimeoutMinutes({
          severity,
          points,
          projectedRisk: currentRisk,
          suspicion: currentSuspicion,
          profile,
          safeMode: getState("aimod_safe_mode"),
        })
      : 0;

  final = {
    action: normalizeExclusiveAction(forcedAction),
    category: "harassment",
    categoryHu: "Nyers, trágár kommunikáció",
    severity,
    confidence: 84,
    points,
    projectedRisk: currentRisk,
    suspicionGain,
    ruleBroken: "Indokolatlanul trágár kommunikáció.",
    reason: "A rendszer nem célzott, de nyers és közösségromboló megfogalmazást talált.",
    analysis:
      mildRepeatCount >= 2
        ? "A felhasználó rövid időn belül többször használ trágár megfogalmazást."
        : "A felhasználó nyers, trágár megfogalmazást használt.",
    patternSummary:
      mildRepeatCount >= 2
        ? `Ismétlődő nyers beszéd (${mildRepeatCount + 1}. eset rövid időn belül).`
        : "Egyszeri nyers beszéd.",
    shouldNotifyStaff: false,
    moderationMode: getModerationMode(),
    shieldReason: "",
    bypassScore: Number(bypass?.score || 0),
    replyTarget: replyTarget?.targetTag || "",
    timeoutMinutes,
  };
}

    const final = finalDecision({
      profile,
      ruleScan,
      aiResult,
      bypass,
      replyTarget,
      shield,
      userId: member.id,
    });

    if (final.action === "ignore") {
      if (final.shouldNotifyStaff) {
        setActiveCase(profile, {
          lastAction: actionToLabel(final.action),
          lastActionRaw: final.action,
          lastReason: final.reason,
          lastCategory: final.categoryHu,
          lastSeverity: final.severity,
          lastAnalysis: final.analysis,
          lastPatternSummary: final.patternSummary,
          lastRuleBroken: final.ruleBroken,
          lastMessageContent: cleanText(message.content || "", 1000),
          lastMessageId: message.id,
          lastChannelId: message.channelId,
          lastProjectedRisk: final.projectedRisk,
          lastEvidence: buildEvidenceText(message, ruleScan, final, bypass, replyTarget),
          lastModerationMode: final.moderationMode,
          lastShieldReason: final.shieldReason,
          lastBypassScore: final.bypassScore,
          lastReplyTarget: final.replyTarget,
          currentStatus: "Megfigyelés",
        });
        saveStore();
        await resendUnifiedCaseMessage(client, member, profile).catch(() => null);
      }
      return;
    }

    const performed = await applyDecision({
      client,
      message,
      member,
      profile,
      final,
    });

    if (!performed) return;

    profile.behaviorScore = Math.max(
      0,
      Number(profile.behaviorScore || 0) + Math.round(final.points / 8)
    );
    profile.escalationLevel = getEscalationTrend(profile).level;

    addIncident(member.id, {
      type: final.action,
      createdAt: now(),
      points: final.points,
      suspicion: final.suspicionGain,
      severity: final.severity,
      category: final.category,
      content: cleanText(message.content || "", 500),
      messageId: message.id,
      channelId: message.channelId,
      confidence: final.confidence,
      moderationMode: final.moderationMode,
    });

    setActiveCase(profile, {
      lastAction: actionToLabel(final.action),
      lastActionRaw: final.action,
      lastReason: final.reason,
      lastCategory: final.categoryHu,
      lastSeverity: final.severity,
      lastAnalysis: final.analysis,
      lastPatternSummary: final.patternSummary,
      lastRuleBroken: final.ruleBroken,
      lastMessageContent: cleanText(message.content || "", 1000),
      lastMessageId: message.id,
      lastChannelId: message.channelId,
      lastProjectedRisk: final.projectedRisk,
      lastEvidence: buildEvidenceText(message, ruleScan, final, bypass, replyTarget),
      lastModerationMode: final.moderationMode,
      lastShieldReason: final.shieldReason,
      lastBypassScore: final.bypassScore,
      lastReplyTarget: final.replyTarget,
      currentStatus:
        final.action === "ban"
          ? "Kitiltva"
          : final.action === "kick"
            ? "Kirúgva"
            : final.action === "timeout"
              ? "Időkorlátozva"
              : final.action === "delete"
                ? "Üzenet törölve"
                : final.action === "warn"
                  ? "Figyelmeztetve"
                  : final.action === "watch"
                    ? "Megfigyelés alatt"
                    : "Megfigyelés",
    });

    saveStore();

    if (final.shouldNotifyStaff || final.points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG) {
      await resendUnifiedCaseMessage(client, member, profile).catch(() => null);
    }
  } catch (error) {
    console.error("[AIMOD] processMessage hiba:", error);
  }
}

function highestCategoryFromRule(hits = []) {
  const best = pickHighestRuleHit(hits);
  return best?.key || "other";
}

function buildEvidenceText(message, ruleScan, final, bypass, replyTarget) {
  const hitText = (ruleScan.hits || [])
    .map((h) => `• ${h.label} (${h.points})`)
    .join("\n") || "Nincs szabályalapú találat.";

  const behaviorText =
    Array.isArray(final.behaviorLabels) && final.behaviorLabels.length
      ? final.behaviorLabels.map((x) => `• ${x}`).join("\n")
      : "Nincs külön viselkedési extra.";

  return cleanText(
    [
      `Csatorna: #${message?.channel?.name || "ismeretlen"}`,
      `Confidence: ${Number(final.confidence || 0)}`,
      `Pont: ${Number(final.points || 0)}`,
      `Projected risk: ${Number(final.projectedRisk || 0)}%`,
      `Moderációs mód: ${final.moderationMode || "balanced"}`,
      `Bypass score: ${Number(bypass?.score || 0)}`,
      `Reply célpont: ${
        replyTarget?.targetTag ||
        (replyTarget?.targetId ? replyTarget.targetId : "nincs")
      }`,
      `Reply staff: ${replyTarget?.targetIsStaff ? "igen" : "nem"}`,
      `Feedback delta: ${Number(final.feedbackDelta || 0)}`,
      `Escalation: ${final.escalationLabel || "nincs"}`,
      `\nRule találatok:\n${hitText}`,
      `\nViselkedési jelek:\n${behaviorText}`,
      bypass?.hits?.length
        ? `\nBypass találatok:\n${bypass.hits.map((x) => `• ${x}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    1500
  );
}

async function handleSlashCommand(client, interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (!getState("aimod_enabled")) {
    if (interaction.isRepliable()) {
      await interaction
        .reply({
          content: "❌ Az AI moderáció jelenleg ki van kapcsolva.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
    return true;
  }

  if (interaction.commandName === "delaiwarn") {
    await handleDelAiWarnCommand(client, interaction);
    return true;
  }

  if (interaction.commandName === "mute") {
    await handleMuteCommand(client, interaction);
    return true;
  }

  return false;
}

function resetAiRiskProfile(userId) {
  const oldProfile = getUserProfile(userId);

  store.users[userId] = {
    incidents: [],
    recentMessages: [],
    lastCaseAt: 0,
    watchUntil: 0,
    suspicion: 0,
    behaviorScore: 0,
    escalationLevel: 0,
    
    activeCase: {
      lastAction: "AI kockázat törölve",
      lastReason: "Staff kézzel lenullázta a kockázatot.",
      lastCategory: "Manuális törlés",
      lastSeverity: "enyhe",
      lastAnalysis:
        "A felhasználó AI moderációs előzményei és kockázati profilja kézzel lenullázásra kerültek.",
      lastPatternSummary: "A korábbi AI incidensek törölve lettek.",
      lastMessageContent: "",
      lastUpdatedAt: Date.now(),
      currentStatus: "Kockázat lenullázva",
    },
    totals: {
      warnings: 0,
      deletions: 0,
      timeouts: 0,
      kicks: 0,
      bans: 0,
      unbans: 0,
      forgiveness: 0,
      watches: 0,
      shields: 0,
    },
  };

  return oldProfile;
}

async function handleDelAiWarnCommand(client, interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Ez a parancs csak szerveren használható.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasStaffPermission(interaction)) {
    await interaction.reply({
      content: "Ehhez staff jogosultság kell.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const userOption = interaction.options.getUser("felhasznalo");
  const nameOption = cleanText(
    interaction.options.getString("nev") || "",
    100
  );

  let member = null;

  if (userOption) {
    member =
      interaction.guild.members.cache.get(userOption.id) ||
      (await interaction.guild.members.fetch(userOption.id).catch(() => null));
  } else if (nameOption) {
    member = await findGuildMemberByName(interaction.guild, nameOption);
  }

  if (!member) {
    await interaction.editReply({
      content:
        "❌ Nem találtam ilyen játékost a szerveren. Add meg a pontos nevet vagy használd a felhasználó opciót.",
    });
    return;
  }

  const beforeProfile = getUserProfile(member.id);
  const beforeRisk = getRiskPercent(beforeProfile);

  resetAiRiskProfile(member.id);

  const profile = getUserProfile(member.id);
  saveStore();

  await resendUnifiedCaseMessage(client, member, profile).catch(() => null);

  await interaction.editReply({
    content:
      `✅ Az AI kockázat törölve lett ennél a játékosnál: ${member.user.tag}\n` +
      `📉 Előző kockázat: **${beforeRisk}%**\n` +
      `📊 Új kockázat: **${getRiskPercent(profile)}%**`,
  });
}
async function handleMuteCommand(client, interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Ez a parancs csak szerveren használható.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasStaffPermission(interaction)) {
    await interaction.reply({
      content: "Ehhez staff jogosultság kell.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const targetUser = interaction.options.getUser("felhasznalo", true);
  const minutes = interaction.options.getInteger("perc", true);
  const originalReason = cleanText(
    interaction.options.getString("indok", true),
    500
  );

  const member =
    interaction.guild.members.cache.get(targetUser.id) ||
    (await interaction.guild.members.fetch(targetUser.id).catch(() => null));

  if (!member) {
    await interaction.editReply({
      content: "❌ Nem találom ezt a felhasználót a szerveren.",
    });
    return;
  }

  if (member.user?.bot) {
    await interaction.editReply({
      content: "❌ Botot nem tudsz ezzel a paranccsal némítani.",
    });
    return;
  }

  if (member.id === interaction.user.id) {
    await interaction.editReply({
      content: "❌ Magadat nem némíthatod ezzel a paranccsal.",
    });
    return;
  }

  if (isStaff(member) || hasExemptRole(member)) {
    await interaction.editReply({
      content: "❌ Staff vagy védett felhasználó nem némítható ezzel a paranccsal.",
    });
    return;
  }

  if (!member.moderatable) {
    await interaction.editReply({
      content:
        "❌ Ezt a felhasználót nem tudom timeoutolni. Valószínűleg magasabb rangja van vagy hiányzik a jogosultság.",
    });
    return;
  }

  const aiReason = await rewriteManualMuteReason(
    originalReason,
    minutes,
    interaction.user.tag
  );

  const ok = await safeTimeout(
    member,
    minutes,
    `Kézi mute • ${interaction.user.tag}: ${originalReason}`
  );

  if (!ok) {
    await interaction.editReply({
      content: "❌ Nem sikerült a mute / timeout végrehajtása.",
    });
    return;
  }

  const profile = getUserProfile(member.id);

  let manualPoints = 0;
  if (minutes <= 10) manualPoints = 12;
  else if (minutes <= 30) manualPoints = 18;
  else if (minutes <= 60) manualPoints = 24;
  else if (minutes <= 180) manualPoints = 32;
  else manualPoints = 40;

  const suspicionAdd = Math.min(20, Math.max(6, Math.round(manualPoints * 0.45)));

  addIncident(member.id, {
    createdAt: Date.now(),
    action: "timeout",
    category: "staff_manual_timeout",
    severity:
      minutes >= 180 ? "magas" :
      minutes >= 60 ? "közepes" :
      "enyhe",
    points: manualPoints,
    suspicion: suspicionAdd,
    confidence: 100,
    source: "staff_manual",
    reason: originalReason,
    aiReason,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    durationMinutes: minutes,
  });

  profile.totals.timeouts = (profile.totals.timeouts || 0) + 1;
  profile.suspicion = Math.max(0, Number(profile.suspicion || 0)) + suspicionAdd;

  profile.activeCase = {
    ...(profile.activeCase || {}),
    lastAction: `Kézi mute (${minutes} perc)`,
    lastActionRaw: "timeout",
    lastReason: aiReason || originalReason,
    lastCategory: "Kézi staff timeout",
    lastSeverity:
      minutes >= 180 ? "magas" :
      minutes >= 60 ? "közepes" :
      "enyhe",
    lastAnalysis:
      `A felhasználó kézi mute-ot kapott ${minutes} percre. ` +
      `Staff indok: ${originalReason}. AI átírt indok: ${aiReason}`,
    lastPatternSummary: `Kézi staff beavatkozás ${interaction.user.tag} által.`,
    lastRuleBroken: originalReason,
    lastMessageContent: "-",
    lastMessageId: null,
    lastChannelId: interaction.channelId,
    lastProjectedRisk: getRiskPercent(profile),
    lastEvidence:
      `Kézi mute • ${minutes} perc • Staff: ${interaction.user.tag} • Indok: ${originalReason}`,
    lastModerationMode: "manual",
    lastShieldReason: "",
    lastBypassScore: 0,
    lastReplyTarget: "",
    lastUpdatedAt: Date.now(),
    currentStatus: "Kézi mute / timeout",
  };

  saveStore();

const dmSent = await sendManualMuteDM(member.user, {
  minutes,
  moderatorTag: interaction.user.tag,
  originalReason,
  aiReason,
  profile,
  member,
}).catch(() => false);

  await resendUnifiedCaseMessage(client, member, profile).catch(() => null);

  await interaction.editReply({
    content:
      `✅ ${member.user.tag} némítva lett **${minutes}** percre.\n` +
      `📄 Eredeti indok: ${originalReason}\n` +
      `🤖 AI indok: ${aiReason}\n` +
      `📈 Hozzáadott pont: **${manualPoints}**\n` +
      `📊 Új risk:\n${formatRiskBlock(profile)}\n` +
      `✉️ DM állapot: ${dmSent ? "✅ elküldve" : "⚠️ nem sikerült elküldeni"}`,
  });
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
        store.feedback.reviewOk[userId] =
          (store.feedback.reviewOk[userId] || 0) + 1;
        saveStore();
        return handleButtonLabelSwap(interaction, "Elküldve - Jól döntött");
      }

      if (action === "mistake") {
        store.feedback.mistake[userId] =
          (store.feedback.mistake[userId] || 0) + 1;
        saveStore();

        const profile = getUserProfile(userId);
        profile.totals.forgiveness = (profile.totals.forgiveness || 0) + 1;
        profile.suspicion = Math.max(0, Number(profile.suspicion || 0) - 12);
        profile.watchUntil = 0;
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
      const modalAction = parts[1];
      const userId = parts[2];
      const customReason = cleanText(
        interaction.fields.getTextInputValue("reason") || "",
        700
      );

      const guild = interaction.guild;
      const member =
        guild?.members?.cache?.get(userId) ||
        (guild ? await guild.members.fetch(userId).catch(() => null) : null);

      const profile = getUserProfile(userId);

      if (modalAction === "apology_modal") {
        const ok = await sendApologyDM(member?.user, customReason);
        if (ok) {
          profile.totals.forgiveness = (profile.totals.forgiveness || 0) + 1;
          profile.suspicion = Math.max(0, Number(profile.suspicion || 0) - 10);
          profile.watchUntil = 0;
          setActiveCase(profile, {
            lastAction: "Bocsánatkérés elküldve",
            lastActionRaw: "unban",
            lastReason: customReason || "AI által generált bocsánatkérés.",
            lastCategory: "Staff korrekció",
            lastSeverity: "enyhe",
            lastAnalysis:
              "A staff felülvizsgálta az ügyet, és bocsánatkérő üzenetet küldött a felhasználónak.",
            lastPatternSummary:
              "Staff beavatkozás után enyhítés történt.",
            currentStatus: "Felülvizsgálva",
          });
          saveStore();
          if (member) {
            await resendUnifiedCaseMessage(client, member, profile).catch(
              () => null
            );
          }
        }

        return interaction.reply({
          content: ok
            ? "✅ A bocsánatkérés elküldve."
            : "❌ Nem sikerült elküldeni a bocsánatkérést DM-ben.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (modalAction === "unban_modal") {
        let ok = false;

        try {
          if (guild) {
            await guild.members.unban(userId, customReason || "AI moderáció utólagos feloldás");
            ok = true;
          }
        } catch (error) {
          console.error("[AIMOD] unban hiba:", error);
        }

        if (ok) {
          reduceRiskAfterUnban(profile);
          await sendUnbanDM(member?.user, customReason).catch(() => null);

          setActiveCase(profile, {
            lastAction: "Feloldás / unban",
            lastActionRaw: "unban",
            lastReason: customReason || "Staff feloldotta a korlátozást.",
            lastCategory: "Staff korrekció",
            lastSeverity: "enyhe",
            lastAnalysis:
              "A korábbi AI szankció feloldásra került staff döntés alapján.",
            lastPatternSummary:
              "Unban után csökkentett risk / suspicion állapot.",
            currentStatus: "Feloldva",
          });

          saveStore();
          if (member) {
            await resendUnifiedCaseMessage(client, member, profile).catch(
              () => null
            );
          }
        }

        return interaction.reply({
          content: ok
            ? "✅ A feloldás megtörtént."
            : "❌ Nem sikerült a feloldás.",
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        content: "Ismeretlen AI moderációs modal.",
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error("[AIMOD] handleInteraction hiba:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "Hiba történt a művelet közben.",
        });
      } else if (interaction.isRepliable()) {
        await interaction.reply({
          content: "Hiba történt a művelet közben.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {}
  }
}

function registerAiModeration(client) {
  client.on("messageCreate", async (message) => {
    await processMessage(client, message);
  });

  client.on("interactionCreate", async (interaction) => {
    if (
      (interaction.isButton() || interaction.isModalSubmit()) &&
      interaction.customId?.startsWith("aimod:")
    ) {
      await handleInteraction(client, interaction);
    }
  });
}

module.exports = {
  registerAiModeration,
  handleSlashCommand,
  handleInteraction,
};