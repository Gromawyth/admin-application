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

WATCH_THRESHOLD: 45,
HIGH_RISK_THRESHOLD: 60,
KICK_NEAR_THRESHOLD: 85,
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
WATCH_BASE_POINTS: 4,
WATCH_WINDOW_MS: 15 * 60 * 1000,

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
      feedback: parsed.feedback || {
        reviewOk: {},
        mistake: {},
      },
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
function formatDuration(ms) {
  const value = Number(ms || 0);

  if (!Number.isFinite(value) || value <= 0) {
    return "Ismeretlen";
  }

  const totalSeconds = Math.floor(value / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];

  if (days > 0) parts.push(`${days} nap`);
  if (hours > 0) parts.push(`${hours} óra`);
  if (minutes > 0) parts.push(`${minutes} perc`);

  if (!parts.length && seconds > 0) {
    parts.push(`${seconds} másodperc`);
  }

  return parts.join(" ");
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

    const type = String(inc.type || "");
    const basePoints = Number(inc.points || 0);

    let typeMultiplier = 1;

    if (type === "watch") typeMultiplier = 0.28;
    else if (type === "warn") typeMultiplier = 0.42;
    else if (type === "delete") typeMultiplier = 0.72;
    else if (type === "timeout") typeMultiplier = 1;
    else if (type === "kick") typeMultiplier = 1.15;
    else if (type === "ban") typeMultiplier = 1.3;

    risk += basePoints * typeMultiplier * weight;
  }

  risk += (profile.totals?.timeouts || 0) * 8;
  risk += (profile.totals?.kicks || 0) * 16;
  risk += (profile.totals?.bans || 0) * 26;
  risk -= (profile.totals?.forgiveness || 0) * 8;

  const rehabScore = Number(profile.rehab?.score || 0);
  risk -= rehabScore * 0.3;

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
  const liveRisk = getRiskPercent(profile);
  profile.behaviorScore = liveRisk;

  const risk = Math.max(0, Math.min(100, Math.round(liveRisk)));
  const filled = Math.round(risk / 10);

  let bar = "";

  for (let i = 0; i < 10; i++) {
    if (i >= filled) {
      bar += "⬜";
    } else if (i < 4) {
      bar += "🟩";
    } else if (i < 5) {
      bar += "🟨";
    } else if (i < 7) {
      bar += "🟧";
    } else {
      bar += "🟥";
    }
  }

  let status = "Stabil";
  if (risk >= 75) {
    status = "Kritikus";
  } else if (risk >= 50) {
    status = "Kockázatos";
  } else if (risk >= 25) {
    status = "Figyelendő";
  }

  return `╭ Kockázat\n${bar} **${risk}%**\n╰ Állapot: **${status}**`;
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
    `Szint: **${rehab.level || "nincs"}**\n`
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
function buildImmediateRuleDecision(message, profile) {
  const content = String(message?.content || "").trim();
  const lower = content.toLowerCase();

  if (!content) return null;

  // 1) RP / múlt idejű esemény sose legyen threat
  if (isRpSafeViolenceContext(content)) {
    return {
      action: "ignore",
      category: "clean",
      categoryHu: "RP / eseményleírás",
      severity: "enyhe",
      confidence: 96,
      points: 0,
      suspicionGain: 0,
      ruleBroken: "Nincs közvetlen szabálysértés.",
      reason: "A rendszer RP vagy múlt idejű eseményleírást talált, nem aktív fenyegetést.",
      analysis: "Az üzenet helyzetjelentésnek vagy szerepjátékbeli eseményleírásnak tűnik, ezért automata büntetés nem indokolt.",
      patternSummary: "RP / eseményleírás védve.",
      timeoutMinutes: 0,
      shouldNotifyStaff: false,
      forceWatch: false,
    };
  }

  const repeatCount = countRecentTargetedInsults(profile, content);
  const watchActive = isWatchActive(profile);
  const currentRisk = getRiskPercent(profile);
  const recentProfanityCount = (profile.recentMessages || [])
    .slice(-8)
    .filter((m) => isContextualProfanity(m.content || ""))
    .length;

  // 2) Aktív fenyegetés külön kezelése
  if (isActiveThreat(content)) {
    let action = "delete";
    let severity = "közepes";
    let points = 56;
    let suspicionGain = 16;

    if (watchActive || currentRisk >= 45 || repeatCount >= 1) {
      action = "timeout";
      points = 70;
      suspicionGain = 22;
    }

    if (currentRisk >= 72 || repeatCount >= 3) {
      action = "kick";
      severity = "magas";
      points = 86;
      suspicionGain = 28;
    }

    if (currentRisk >= 90 || repeatCount >= 5) {
      action = "ban";
      severity = "kritikus";
      points = 98;
      suspicionGain = 36;
    }

    return {
      action,
      category: "threat",
      categoryHu: "Aktív fenyegetés",
      severity,
      confidence: 97,
      points,
      suspicionGain,
      ruleBroken: "Közvetlen, aktív fenyegetés.",
      reason: "A rendszer egyértelmű aktív fenyegetést talált.",
      analysis: "Az üzenet nem múlt idejű RP leírás, hanem jövőre vagy közvetlen cselekvésre utaló fenyegetés.",
      patternSummary: "Aktív fenyegetés detektálva.",
      timeoutMinutes: severity === "közepes" ? 60 : severity === "magas" ? 360 : 1440,
      shouldNotifyStaff: true,
      forceWatch: true,
    };
  }

  // 3) Rasszista célzott beszólás külön kezelése
  if (isRacistAbuse(content)) {
    const repeated = watchActive || currentRisk >= 45 || repeatCount >= 1;

    return {
      action: repeated ? "timeout" : "delete",
      category: "harassment",
      categoryHu: "Rasszista / etnikai alapú sértés",
      severity: repeated ? "magas" : "közepes",
      confidence: 97,
      points: repeated ? 72 : 58,
      suspicionGain: repeated ? 24 : 16,
      ruleBroken: "Célzott rasszista vagy etnikai alapú sértés.",
      reason: "A rendszer célzott, lealacsonyító etnikai sértést talált.",
      analysis: repeated
        ? "A felhasználó visszaeső vagy emelt kockázatú állapotban célzott rasszista sértést használt."
        : "Az üzenet célzott, sértő etnikai minősítést tartalmaz.",
      patternSummary: repeated
        ? "Ismétlődő rasszista sértés."
        : "Azonnali törlendő rasszista sértés.",
      timeoutMinutes: repeated ? 180 : 0,
      shouldNotifyStaff: true,
      forceWatch: true,
    };
  }

  // 4) Enyhébb rasszista súrolás -> watch / delete
  if (isSoftRacistFriction(content)) {
    const escalate = watchActive || currentRisk >= 45 || repeatCount >= 1;

    return {
      action: escalate ? "delete" : "watch",
      category: "other",
      categoryHu: "Figyelendő etnikai utalás",
      severity: escalate ? "közepes" : "enyhe",
      confidence: escalate ? 88 : 80,
      points: escalate ? 28 : 14,
      suspicionGain: escalate ? 10 : 5,
      ruleBroken: "Provokatív, etnikai alapú feszültségkeltés.",
      reason: escalate
        ? "A rendszer szerint ez már nem első problémás etnikai utalás."
        : "A rendszer etnikai alapú, provokatív utalást talált.",
      analysis: escalate
        ? "A felhasználó ismételten vagy emelt risk mellett használ etnikai alapon feszültséget keltő megfogalmazást."
        : "Az üzenet még nem a legerősebb sértési szint, de erősen figyelendő.",
      patternSummary: escalate
        ? "Visszatérő etnikai alapú provokáció."
        : "Watch szintű etnikai provokáció.",
      timeoutMinutes: 0,
      shouldNotifyStaff: true,
      forceWatch: true,
    };
  }

  // 5) enyhe trágárság finomítva
  if (isContextualProfanity(content)) {
    let action = "watch";
    let severity = "enyhe";
    let points = 4;
    let suspicionGain = 1;
    let confidence = 82;

    if (recentProfanityCount >= 2 || (watchActive && currentRisk >= 45) || currentRisk >= 50) {
      action = "warn";
      severity = "enyhe";
      points = 6;
      suspicionGain = 2;
      confidence = 86;
    }

    if (recentProfanityCount >= 4 || currentRisk >= 65) {
      action = "delete";
      severity = "közepes";
      points = 10;
      suspicionGain = 4;
      confidence = 90;
    }

    return {
      action,
      category: "other",
      categoryHu: "Nyers / trágár megfogalmazás",
      severity,
      confidence,
      points,
      suspicionGain,
      ruleBroken: "Indokolatlanul trágár, feszült megfogalmazás.",
      reason:
        action === "watch"
          ? "A rendszer enyhe, nem célzott, de figyelendő trágár megfogalmazást talált."
          : action === "warn"
            ? "A rendszer ismétlődő vagy emelt kockázatú nyers, trágár megfogalmazást talált."
            : "A rendszer ismétlődő nyers, trágár megfogalmazást talált, ezért már törlés indokolt.",
      analysis:
        action === "watch"
          ? "Az üzenet nem közvetlen célzott sértés, de a hangnem már nem kulturált."
          : action === "warn"
            ? "Az üzenet önmagában még nem súlyos személyeskedés, de a visszatérő nyers hangnem miatt figyelmeztetés indokolt."
            : "A felhasználó visszatérően használ nyers, trágár hangnemet, ezért a rendszer szigorúbban reagál.",
      patternSummary:
        action === "watch"
          ? "Első szintű trágár megfogalmazás."
          : action === "warn"
            ? "Ismétlődő trágár megfogalmazás."
            : "Visszatérő trágár hangnem.",
      timeoutMinutes: 0,
      shouldNotifyStaff: false,
      forceWatch: true,
    };
  }

  const targetedDegrading = isTargetedDegradingMessage(content);

  const familyInsultDetected = containsCanonical(content, FAMILY_INSULT_WORDS);

  const directInsultDetected =
    containsInsultWord(content) &&
    (
      containsTargetWord(content) ||
      /\b(te|ti|neked|nektek|vagy|vagytok|takarodj|kuss)\b/i.test(lower)
    );

  const recentFamilyInsultCount = (profile.recentMessages || [])
    .slice(-6)
    .filter((m) => containsCanonical(m.content || "", FAMILY_INSULT_WORDS))
    .length;

  const directHarassment = familyInsultDetected || directInsultDetected;

  const softStaffFriction =
    /\b(admin|adminok|staff|moder[aá]tor|moderátor|vezetőség|fejleszt[őo]k?|szerver|rendszer|internalgaming)\b/i.test(lower) &&
    /\b(gáz|vicc|nevetséges|komolytalan|káosz|szétesett|gyenge|borzalmas|agyrém|szánalmas|kellemetlen|fárasztó)\b/i.test(lower) &&
    !targetedDegrading;

  const softPersonalFriction =
    /\b(te|ti|neked|nektek|vagy|vagytok)\b/i.test(lower) &&
    /\b(idegesítő|komolytalan|gyerekes|fárasztó|nevetséges|okoskodsz|provokálsz|túltolod|nagyon sok vagy|unalmas)\b/i.test(lower) &&
    !directHarassment;

  const provocativeDisruption =
    /\b(fejezd be|hagyd abba|ne kezdd megint|megint ezt csinálod|nagyon unalmas ez már|megint a hiszti|ezt hagyd|ne told túl)\b/i.test(lower);

  const notBelongingBehavior =
    /\b(kussoljon mindenki|kuss legyen|mindenki fogja be|szétspamellek|tele fogom floodolni|szét fogom baszni a chatet)\b/i.test(lower);

  if (targetedDegrading) {
    let action = "delete";
    let severity = "közepes";
    let points = 54;
    let suspicionGain = 14;

    if (repeatCount >= 1 || watchActive || currentRisk >= 45) {
      action = "timeout";
      severity = "közepes";
      points = 68;
      suspicionGain = 20;
    }

    if (repeatCount >= 3 || currentRisk >= 70) {
      action = "kick";
      severity = "magas";
      points = 84;
      suspicionGain = 28;
    }

    if (repeatCount >= 5 || currentRisk >= 90) {
      action = "ban";
      severity = "kritikus";
      points = 96;
      suspicionGain = 34;
    }

    return {
      action,
      category: "staff_abuse",
      categoryHu: "Szerver / staff szidalmazása",
      severity,
      confidence: 96,
      points,
      suspicionGain,
      ruleBroken: "Célzott szerver / staff / közösség szidalmazása.",
      reason: "A rendszer célzott szerver / staff / közösség elleni sértő minősítést talált.",
      analysis:
        repeatCount >= 1
          ? "A felhasználó célzott, sértő minősítést használt, ráadásul ez nem első eset."
          : "A felhasználó célzott, sértő minősítést használt a szerverre, staffra vagy közösségre.",
      patternSummary:
        repeatCount >= 1
          ? `Ismétlődő célzott szerver / staff szidalmazás (${repeatCount + 1}).`
          : "Azonnali törlendő célzott szerver / staff szidalmazás.",
      timeoutMinutes: 0,
      shouldNotifyStaff: true,
      forceWatch: true,
    };
  }

  if (directHarassment) {
    const repeatedHarassment =
      repeatCount >= 1 || recentFamilyInsultCount >= 1;

    return {
      action: repeatedHarassment || watchActive || currentRisk >= 45 ? "timeout" : "delete",
      category: "harassment",
      categoryHu: "Célzott sértegetés",
      severity: "közepes",
      confidence: 96,
      points: repeatedHarassment || watchActive || currentRisk >= 45 ? 62 : 50,
      suspicionGain: repeatedHarassment || watchActive || currentRisk >= 45 ? 18 : 12,
      ruleBroken: "Célzott sértegetés / szidalmazás.",
      reason: familyInsultDetected
        ? "A rendszer családi sértést talált, akár obfuszkált formában is."
        : "A rendszer közvetlen, célzott sértést talált.",
      analysis: repeatedHarassment
        ? "A felhasználó rövid időn belül ismételten célzott sértést használt."
        : "A felhasználó más személy felé irányuló sértő hangnemet használt.",
      patternSummary: repeatedHarassment
        ? "Ismétlődő célzott sértés."
        : "Azonnali törlendő célzott sértés.",
      timeoutMinutes: 0,
      shouldNotifyStaff: true,
      forceWatch: true,
    };
  }

  if (softStaffFriction || softPersonalFriction || provocativeDisruption || notBelongingBehavior) {
    const escalateSoft = watchActive || currentRisk >= CONFIG.WATCH_THRESHOLD || repeatCount >= 1;

    return {
      action: escalateSoft ? "delete" : "watch",
      category: "other",
      categoryHu: "Provokatív / figyelendő viselkedés",
      severity: escalateSoft ? "közepes" : "enyhe",
      confidence: escalateSoft ? 86 : 78,
      points: escalateSoft ? 32 : 18,
      suspicionGain: escalateSoft ? 12 : 7,
      ruleBroken: "Provokatív, konfliktusgerjesztő vagy nem odatartozó viselkedés.",
      reason: escalateSoft
        ? "A rendszer szerint ez már nem első figyelmeztető jellegű megnyilvánulás."
        : "A rendszer konfliktus felé tartó, de még nem teljesen egyértelmű sértő mintát talált.",
      analysis: escalateSoft
        ? "A felhasználó ismételten vagy emelt kockázati állapotban provokatív hangnemet használt, ezért már törlés indokolt."
        : "Az üzenet még nem a legerősebb sértési szint, de egyértelműen feszült, provokatív és figyelendő.",
      patternSummary: escalateSoft
        ? "Watch utáni vagy magasabb risk melletti újabb provokatív üzenet."
        : "Watch szintű felvezető konfliktus / passzív-agresszív minta.",
      timeoutMinutes: 0,
      shouldNotifyStaff: true,
      forceWatch: true,
    };
  }

  return null;
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

  // RP / eseményjelentés védelem
  if (isRpSafeViolenceContext(content)) {
    return { block: true, reason: "RP vagy múlt idejű eseményleírás, nem aktív fenyegetés." };
  }

  if (
    hasRpContext(content) &&
    /\b(lelőttek|lelőttek|meglőttek|megöltek|meghaltam|meghalt|kiraboltak|elraboltak|megvertek|leszúrtak|bevittek)\b/i.test(content) &&
    !isActiveThreat(content)
  ) {
    return { block: true, reason: "RP kontextusú helyzetjelentés / eseményleírás." };
  }

  // semleges etnikai említés ne büntessen
  if (
    /\b(cigány|roma|cigányok|romák)\b/i.test(content) &&
    !isRacistAbuse(content) &&
    !containsInsultWord(content)
  ) {
    return { block: true, reason: "Semleges etnikai említés, nem automata büntetési eset." };
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

if (recentCounts.last7d >= 1) {
  score += 4;
}

if (recentCounts.last7d >= 2) {
  score += 6;
}

if (recentCounts.last7d >= 4) {
  score += 8;
}

if (recentCounts.last30d >= 3) {
  score += 6;
}

if (recentCounts.last30d >= 5) {
  score += 8;
}

if (recentCounts.last30d >= 8) {
  score += 10;
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
function getModerationMode() {
  const safeMode = getState("aimod_safe_mode");

  if (safeMode) return "safe";

  return "balanced";
}
async function applyModerationDecision(client, message, profile, final) {
  const member = message.member;

  if (!member) return;

  // ne moderáljon ha nem tud
  if (!canModerateTarget(member)) return;

  const action = final.action;
const shouldDeleteTriggerMessage = ["delete", "timeout", "kick", "ban"].includes(action);
  try {
    // =========================
    // DELETE
    // =========================
if (shouldDeleteTriggerMessage && CONFIG.ALLOW_DELETE) {
  const deleted = await message.delete().catch(() => null);
  if (deleted || action === "delete") {
    profile.totals.deletions++;
  }
}

    // =========================
    // TIMEOUT
    // =========================
    if (action === "timeout") {
      if (CONFIG.ALLOW_TIMEOUT) {
        const timeoutMinutes = Number(final.timeoutMinutes || 10) > 0
          ? Number(final.timeoutMinutes)
          : 10;

        const ms = timeoutMinutes * 60 * 1000;

        const dmSent = await sendAiTimeoutDM(
          member.user,
          { ...final, timeoutMinutes },
          member,
          message,
          profile
        ).catch((err) => {
          console.error("[AIMOD] Timeout DM hiba:", err?.message || err);
          return false;
        });

        const timeoutOk = await member.timeout(ms, final.reason || "AI Moderation")
          .then(() => true)
          .catch((err) => {
            console.error("[AIMOD] member.timeout hiba:", err?.message || err);
            return false;
          });

        if (timeoutOk) {
          profile.totals.timeouts++;
          console.log(
            `[AIMOD] Timeout DM állapot ${member.user?.tag || member.id}: ${dmSent ? "elküldve" : "nem sikerült"}`
          );
        }
      }
    }

    // =========================
    // KICK
    // =========================
    if (action === "kick") {
      if (CONFIG.ALLOW_KICK) {
        await member.kick(final.reason || "AI Moderation").catch(() => null);
        profile.totals.kicks++;
      }
    }

    // =========================
    // BAN
    // =========================
    if (action === "ban") {
      if (CONFIG.ALLOW_BAN) {
        await member.ban({
          reason: final.reason || "AI Moderation",
        }).catch(() => null);

        profile.totals.bans++;
      }
    }

    // =========================
    // WATCH
    // =========================
    if (action === "watch") {
      extendWatch(profile);
      profile.suspicion += final.suspicionGain || 5;
    }

    // =========================
    // INCIDENT LOG STORE
    // =========================
    addIncident(member.id, {
      type: action,
      category: final.category,
      severity: final.severity,
      points: final.points,
      suspicion: final.suspicionGain || 0,
      reason: final.reason,
      ruleBroken: final.ruleBroken,
      content: cleanText(message.content || "", 400),
      messageId: message.id,
      channelId: message.channelId,
      createdAt: Date.now(),
    });

    // =========================
    // PROFILE UPDATE
    // =========================
    profile.behaviorScore = getRiskPercent(profile);

    profile.activeCase = {
      ...(profile.activeCase || {}),
      lastAction: actionToLabel(action),
      lastActionRaw: action,
      lastReason: final.reason || "",
      lastCategory: final.categoryHu || categoryToHu(final.category),
      lastSeverity: final.severity || "enyhe",
      lastAnalysis: final.analysis || "",
      lastPatternSummary: final.patternSummary || "",
      lastRuleBroken: final.ruleBroken || "",
      lastMessageContent: cleanText(message.content || "", 500),
      lastMessageId: message.id,
      lastChannelId: message.channelId,
      lastProjectedRisk: profile.behaviorScore,
      lastEvidence: trimField(
        `Üzenet: "${cleanText(message.content || "", 220)}"\nCsatorna: #${message.channel?.name || "ismeretlen"}\nFelhasználó: ${member.user?.tag || member.user?.username || "ismeretlen"}`,
        1024
      ),
      lastModerationMode: getModerationMode(),
      lastUpdatedAt: Date.now(),
      currentStatus: actionToLabel(action),
    };

    saveStore();

    // =========================
    // USER NOTICE
    // =========================
    await sendSingleUserNotice({
      message,
      member,
      profile,
      final,
    }).catch(() => null);

    // =========================
    // MOD-LOG / ÖSSZESÍTŐ FRISSÍTÉS
    // =========================
    try {
      await resendUnifiedCaseMessage(client, member, profile);
    } catch (error) {
      console.error("[AIMOD] automata mod-log hiba:", error);
    }

  } catch (err) {
    console.error("[AIMOD] applyModerationDecision hiba:", err);
  }
}
function getRecentIncidentCounts(profile) {
  const nowTime = Date.now();

  let last7d = 0;
  let last30d = 0;

  for (const inc of profile.incidents || []) {
    const createdAt = inc.createdAt || nowTime;
    const diff = nowTime - createdAt;

    if (diff <= 7 * 24 * 60 * 60 * 1000) last7d++;
    if (diff <= 30 * 24 * 60 * 60 * 1000) last30d++;
  }

  return { last7d, last30d };
}
function summarizeIncidents(profile) {
  const counts = getRecentIncidentCounts(profile);
  const totals = profile.totals || {};

  return {
    seven: `Összes incidens: ${counts.last7d}`,
    thirty: `Összes incidens: ${counts.last30d}`,

    actions:
      `Warn: ${totals.warnings || 0}\n` +
      `Delete: ${totals.deletions || 0}\n` +
      `Timeout: ${totals.timeouts || 0}\n` +
      `Kick: ${totals.kicks || 0}\n` +
      `Ban: ${totals.bans || 0}\n` +
      `Unban: ${totals.unbans || 0}`,
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
function getDefaultAiModerationResult() {
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

function safeParseAiModeration(rawText) {
  const fallback = getDefaultAiModerationResult();
  const raw = String(rawText || "").trim();

  if (!raw) {
    return fallback;
  }

  const extracted = extractJson(raw);

  const candidates = [
    extracted,
    extracted
      .replace(/[„”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/\t/g, " ")
      .replace(/\r/g, " "),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      let confidence = Number(parsed.confidence ?? fallback.confidence);
      if (confidence <= 1) confidence = confidence * 100;

      return {
        category: cleanText(parsed.category || fallback.category, 80),
        categoryHu: cleanText(
          parsed.categoryHu || categoryToHu(parsed.category || fallback.category),
          120
        ),
        severity: normalizeSeverityHu(parsed.severity || fallback.severity),
        confidence: Math.max(0, Math.min(100, Math.round(confidence))),
        points: Math.max(0, Math.round(Number(parsed.points ?? fallback.points))),
        ruleBroken: cleanText(parsed.ruleBroken || fallback.ruleBroken, 220),
        reason: cleanText(parsed.reason || fallback.reason, 500),
        analysis: cleanText(parsed.analysis || fallback.analysis, 1200),
        patternSummary: cleanText(
          parsed.patternSummary || fallback.patternSummary,
          300
        ),
        recommendedAction: normalizeAction(
          parsed.recommendedAction || fallback.recommendedAction
        ),
        timeoutMinutes: Math.max(
          0,
          Math.round(Number(parsed.timeoutMinutes ?? fallback.timeoutMinutes))
        ),
        shouldNotifyStaff: Boolean(parsed.shouldNotifyStaff),
      };
    } catch (_) {}
  }

  console.error("[AIMOD] AI JSON parse hiba, nyers válasz:", raw);

  const inferredCategory =
    /"category"\s*:\s*"([^"]+)"/i.exec(raw)?.[1] || fallback.category;

  const inferredSeverityRaw =
    /"severity"\s*:\s*"([^"]+)"/i.exec(raw)?.[1] || fallback.severity;

  const inferredAction =
    /"recommendedAction"\s*:\s*"([^"]+)"/i.exec(raw)?.[1] ||
    fallback.recommendedAction;

  const inferredPoints = Number(
    /"points"\s*:\s*(\d+)/i.exec(raw)?.[1] || fallback.points
  );

  const inferredTimeout = Number(
    /"timeoutMinutes"\s*:\s*(\d+)/i.exec(raw)?.[1] || fallback.timeoutMinutes
  );

  let inferredConfidence = Number(
    /"confidence"\s*:\s*([0-9.]+)/i.exec(raw)?.[1] || fallback.confidence
  );

  if (inferredConfidence <= 1) inferredConfidence = inferredConfidence * 100;

  return {
    category: cleanText(inferredCategory, 80),
    categoryHu: categoryToHu(inferredCategory),
    severity: normalizeSeverityHu(inferredSeverityRaw),
    confidence: Math.max(0, Math.min(100, Math.round(inferredConfidence))),
    points: Math.max(0, Math.round(inferredPoints)),
    ruleBroken: fallback.ruleBroken,
    reason: fallback.reason,
    analysis: fallback.analysis,
    patternSummary: fallback.patternSummary,
    recommendedAction: normalizeAction(inferredAction),
    timeoutMinutes: Math.max(0, Math.round(inferredTimeout)),
    shouldNotifyStaff: /"shouldNotifyStaff"\s*:\s*true/i.test(raw),
  };
}
function safeParseAiModeration(rawText) {
  const fallback = getDefaultAiModerationResult();
  const raw = String(rawText || "").trim();
  if (!raw) return fallback;

  const extracted = extractJson(raw);

  const candidates = [
    extracted,
    extracted
      .replace(/[„”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/\t/g, " ")
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      return {
        category: cleanText(parsed.category || fallback.category, 80),
        categoryHu: cleanText(parsed.categoryHu || fallback.categoryHu, 120),
        severity: normalizeSeverityHu(parsed.severity || fallback.severity),
        confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence || fallback.confidence)))),
        points: Math.max(0, Math.round(Number(parsed.points || fallback.points))),
        ruleBroken: cleanText(parsed.ruleBroken || fallback.ruleBroken, 220),
        reason: cleanText(parsed.reason || fallback.reason, 500),
        analysis: cleanText(parsed.analysis || fallback.analysis, 700),
        patternSummary: cleanText(parsed.patternSummary || fallback.patternSummary, 220),
        recommendedAction: normalizeAction(parsed.recommendedAction || fallback.recommendedAction),
        timeoutMinutes: Math.max(0, Math.round(Number(parsed.timeoutMinutes || fallback.timeoutMinutes))),
        shouldNotifyStaff: Boolean(parsed.shouldNotifyStaff),
      };
    } catch (_) {}
  }

  console.error("[AIMOD] AI JSON parse hiba, nyers válasz:", raw);

  return {
    ...fallback,
    category: /harassment/i.test(raw) ? "harassment" : fallback.category,
    categoryHu: /Zaklatás|sért/i.test(raw) ? "Zaklatás / sértegetés" : fallback.categoryHu,
    severity: /kritikus/i.test(raw)
      ? "kritikus"
      : /magas/i.test(raw)
        ? "magas"
        : /közepes/i.test(raw)
          ? "közepes"
          : "enyhe",
    recommendedAction: /"recommendedAction"\s*:\s*"timeout"/i.test(raw)
      ? "timeout"
      : /"recommendedAction"\s*:\s*"delete"/i.test(raw)
        ? "delete"
        : /"recommendedAction"\s*:\s*"warn"/i.test(raw)
          ? "warn"
          : /"recommendedAction"\s*:\s*"watch"/i.test(raw)
            ? "watch"
            : "ignore",
    points: Number((raw.match(/"points"\s*:\s*(\d+)/i) || [])[1] || 0),
    timeoutMinutes: Number((raw.match(/"timeoutMinutes"\s*:\s*(\d+)/i) || [])[1] || 0),
    shouldNotifyStaff: /"shouldNotifyStaff"\s*:\s*true/i.test(raw),
  };
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

const TARGET_WORDS = [
  "te", "ti", "neked", "nektek", "veled", "veletek",
  "ellened", "ellenetek", "rád", "rátok", "hozzád", "hozzátok",
  "rólad", "rolad", "róluk", "roluk",
  "nekik", "őt", "őket", "o", "ok", "ő", "ők",
  "vagy", "vagytok",

  "admin", "adminok", "adminék",
  "adminisztrátor", "adminisztrátorok",
  "adminsegéd", "adminsegédek",
  "moderator", "moderátor", "moderátorok",
  "staff",
  "manager", "managerek",
  "tulaj", "tulajdonos", "tulajdonosok",
  "vezetoseg", "vezetőség", "vezetők",
  "fejleszto", "fejlesztő", "fejlesztők",
  "csapat",
  "kozosseg", "közösség",
  "szerver", "server", "szerveretek",
  "rendszer",
  "internalgaming",

  "admin csapat", "vezetőség tagjai",
  "admin emberek", "admin banda",
  "vezető csapat", "admin crew",
  "admin brigád", "vezető brigád",
  "tulaj csapat", "manager csapat",
  "admin team"
];

const MILD_PROFANITY_WORDS = [
  "basszus", "bassza", "basszameg", "bassza meg", "baszki", "baszd", "baszd meg",
  "baszmeg", "bazdmeg", "bazmeg", "bmeg", "bakker", "franc", "francba",
  "a francba", "az istenit", "a mindenit",

  "kurva", "kurvara", "kurvára", "kurvaelet", "kurva elet", "kurvaélet",
  "kurva élet", "kurva életbe", "kurva életbe már",
  "kurvára idegesítő", "kurvára felbasz",
  "kurva gáz", "kurva nagy gáz", "kurva szar",
  "kurva idegesítő", "kurva tré",
  "kurva ideg", "kurva ideges vagyok",

  "geci", "gecire", "gecibe",
  "geci idegesítő", "geci szar", "geci gáz",
  "gecire idegesítő", "gecire szar",
  "geci ideg", "geci ideges vagyok",
  "geci ez",

  "fasz", "faszba", "faszom", "faszomat",
  "fasz kivan", "fasz ki van", "faszkivan",
  "faszom már", "faszom ebbe", "faszom ebbe az egészbe",
  "faszom kivan", "faszom kivan ezzel", "faszom kivan veletek",
  "tele van a faszom", "tele van a faszom ezzel",
  "tele van a faszom a szerverrel", "tele van a faszom az adminokkal",
  "faszság",

  "szar", "szarba", "szar ez", "szar az egész", "szar ez az egész",
  "szar szerver", "szar rendszer",
  "szar az admin", "szar az adminisztrátor", "szar a manager",
  "szar a tulaj", "szar a vezetőség", "szar az adminsegéd",

  "fos", "fos ez", "fos az egész", "fos szerver",
  "fos az admin", "fos az adminisztrátor", "fos a manager",
  "fos a tulaj", "fos a vezetőség", "fos az adminsegéd",

  "szopas", "szopás", "szopjatok",
  "baszas", "baszás",
  "szopás ez", "szopás az egész",

  "szétbasz", "szétbasz az ideg", "felbasz az ideg",
  "felbasz ez", "felbaszott ez az egész",
  "szétidegel",

  "ez egy katasztrófa", "ez botrány", "ez már botrány",
  "ez egy vicc", "ez egy rohadt vicc",
  "ez egy kalap szar", "ez egy rakás szar",
  "ez egy nagy fos", "ez egy nagy szar",
  "röhej az egész", "nevetséges az egész",
  "ez egy szánalom", "ez egy szégyen",
  "ez nagyon tré", "nagyon tré",

  "baszki ez mi", "baszki ez komoly",
  "baszd meg ez mi", "baszd meg ezt",
  "bazdmeg ez komoly", "bazmeg ez mi",
  "bmeg ez mi", "bmeg ez komoly",
  "baszki már megint", "bazdmeg már megint",

  "anyám", "istenit", "rohadt élet", "kibaszott", "rohadtul",
  "lófasz", "lofasz",

  "cigányozás", "romázás",
  "nácizás", "hitlerezés"
];

const INSULT_WORDS = [
  "anyad", "anyadat", "anyatok", "kurvaanyad", "kurva anyad",
  "nyomorek", "nyomorék", "retkes",
  "patkany", "patkány",
  "semmirekello", "semmirekellő",
  "szarhazi", "szarházi",
  "csicska",
  "idiota", "idióta",
  "hulye", "hülye",
  "balfasz", "faszfej", "faszkalap",
  "gecifej", "geciarc",
  "szarfej", "szararc",
  "fosfej", "fosarc",
  "bohoc", "bohóc",
  "majom", "majomfej", "majomarc",
  "kutyafeju", "kutyafejű",
  "allat", "állat",
  "vadbarom", "barom",
  "diszno", "disznó",
  "korcs", "fattyu", "fattyú",
  "ribanc", "lotyo", "lotyó", "ringyo", "ringyó", "cafka",
  "pszichopata", "elmebeteg",
  "orult", "őrült", "zakkant", "bolond", "agybajos",
  "undorito", "undorító",
  "gusztustalan",
  "hanyadek", "hányadék",
  "okadek", "okádék",
  "szutyok", "szenny", "mocsok",
  "dogoljmeg", "dögöljmeg", "rohadjmeg",
  "pusztuljel", "pusztulj",
  "nyomi", "nyominger", "balek", "szerencsétlen",
  "csöves", "csóró", "szánalmas", "nevetséges",
  "gyökér", "agyhalott", "agytalan",
  "retardált", "fogyatékos",
  "hülyegyerek",
  "primitív", "suttyó", "paraszt",
  "bunkó",
  "szar alak", "szar ember",
  "vicc ember", "egy nulla",
  "haszontalan",
  "rohadék", "tetves", "tetves szar",
  "féreg", "gerinctelen", "büdös paraszt",
  "mocskos állat", "rohadt gyökér",
  "bohócfej",
  "szellemi fogyatékos", "agyhalott idióta",

  "egy bohóc vagy", "egy szar vagy", "egy fos vagy",
  "egy senki vagy", "egy nulla vagy",
  "egy idióta vagy", "egy hülye vagy",
  "egy barom vagy", "egy gyökér vagy",
  "egy csicska vagy", "egy nyomorék vagy",
  "egy patkány vagy", "egy féreg vagy",
  "egy szarházi vagy",
  "egy undorító alak vagy",
  "egy gusztustalan ember vagy",
  "egy szánalmas féreg vagy",
  "egy rohadt gyökér vagy",

  "admin bohóc", "admin idióta", "admin hülye", "admin nyomorék", "admin csicska",
  "adminisztrátor bohóc", "adminisztrátor hülye",
  "adminsegéd bohóc", "adminsegéd gyökér",
  "manager bohóc", "manager hülye",
  "tulaj bohóc", "tulaj idióta",
  "vezetőség bohóc", "vezetőség szar", "vezetőség nyomorék"
];

const HATE_SLUR_WORDS = [
  // roma / cigány
  "cigany", "cigány", "ciganyok", "cigányok",
  "roman", "roma", "romak", "romák",
  "büdös cigány", "retkes cigány", "mocskos cigány", "rohadt cigány",

  // fekete / afro / rasszista angol szleng
  "nigger", "nigga", "niga", "niggerek", "niggerek",
  "dirty nigger", "black monkey", "cotton picker",

  // zsidóellenes
  "zsido", "zsidó", "zsidok", "zsidók",
  "büdös zsidó", "mocskos zsidó", "rohadt zsidó",
  "jewboy", "dirty jew", "kike",

  // arab / muszlim / bevándorló
  "terrorista arab", "büdös arab", "mocskos arab",
  "mocskos muszlim", "rohadt muszlim",
  "büdös migráns", "mocskos migráns",

  // ázsiai
  "kinai kutya", "kínai kutya", "csingcsong", "ching chong",
  "gook", "chink",

  // meleg / lmbtq gyűlölet
  "buzi", "buzik", "buzerans", "buzeráns",
  "köcsög buzi", "mocskos buzi",
  "faggot", "dyke", "tranny",

  // náci / szélsőséges
  "náci", "naci", "náci", "hitlerista",
  "heil hitler", "sieg heil", "white power",
  "kkk", "ku klux klan", "skinhead patkány"
];

const FAMILY_INSULT_WORDS = [
  "anyad", "anyadat", "anyatok", "kurvaanyad", "a kurva anyad", "te anyad",
  "anyád", "anyádat", "anyátok",
  "anyadé", "anyádé",
  "anyádé a kurva", "anyád a kurva",
  "anyád kurva", "anyad kurva",
  "anyád egy kurva", "anyad egy kurva",
  "kurvaanyád", "kurvaanyad", "kanyad",
  "k anyad", "k anyád", "k.anyad",
  "kanyád", "k*rva anyád", "k*rva anyad",
  "k.rvanyad", "k.rvanyád",
  "any4d", "4nyad", "4ny4d",
  "any@d", "@nyad",
  "any*d", "any#d", "any$d",
  "anyád*", "*anyád",
  "anyád picsája", "anyad picsaja",
  "anyád picsájába", "anyad picsajaba",
  "anyádba", "anyadba",
  "anyádba bele", "anyadba bele",
  "anyádba menj", "anyadba menj",
  "menj anyádba", "menj anyadba",
  "anyád egy szar", "anyad egy szar",
  "anyád egy fos", "anyad egy fos",
  "anyád egy hulladék", "anyad egy hulladek",
  "anyád egy szutyok", "anyad egy szutyok",
  "anyád egy szenny", "anyad egy szenny",
  "kurva anyád picsája", "kurva anyad picsaja",
  "a kurva anyád picsájába", "a kurva anyad picsajaba",
  "a kurva anyádba", "a kurva anyadba",
  "te kurva anyád", "te kurva anyad",
  "anyád te kurva", "anyad te kurva",
  "anyád egy kurva ribanc", "anyad egy kurva ribanc",
  "anyád egy ribanc", "anyad egy ribanc",
  "anyád egy lotyó", "anyad egy lotyo",
  "anyád egy ringyó", "anyad egy ringyo",
  "anyátok kurva", "anyatok kurva",
  "anyátok egy szar", "anyatok egy szar",
  "anyátok egy fos", "anyatok egy fos",
  "anyátok picsája", "anyatok picsaja",
  "anyád szar", "anyad szar",
  "anyád fos", "anyad fos",
  "anyád hulladék", "anyad hulladek",
  "anyád szutyok", "anyad szutyok",
  "anyádra mondom", "anyadra mondom",
  "anyádra esküszöm", "anyadra eskuszom",
  "anyádra eskü", "anyadra esku",
  "anyádba verem", "anyadba verem",
  "anyádba baszok", "anyadba baszok",
  "anyádba rakom", "anyadba rakom",
  "anyádba tolom", "anyadba tolom",
  "anyd", "anyád?", "anyad?",
  "anyád!!!", "anyad!!!",
  "anyád??", "anyad??",
  "anyád...", "anyad...",
  "4ny@d", "@ny4d",
  "a ny a d", "a.ny.ad",
  "any-ad", "any.ad",
  "any ad",
  "kurva anyád szar", "kurva anyad szar",
  "kurva anyád fos", "kurva anyad fos",
  "kurva anyád hulladék", "kurva anyad hulladek",
  "anyádba dögölj", "anyadba dogolj",
  "anyádba rohadj", "anyadba rohadj",
  "anyádba pusztulj", "anyadba pusztulj",
  "anyád te idióta", "anyad te idiota",
  "anyád te hülye", "anyad te hulye",
  "anyád te nyomorék", "anyad te nyomorek",
  "anyád admin", "anyad admin",
  "anyád adminok", "anyad adminok",
  "anyád adminisztrátor", "anyad adminisztrator",
  "anyád manager", "anyad manager",
  "anyád tulaj", "anyad tulaj",
  "anyád tulajdonos", "anyad tulajdonos",
  "anyád picsa", "anyad picsa",
  "anyád gecis", "anyad gecis",
  "anyád szarházi", "anyad szarhazi"
];

const STAFF_ABUSE_WORDS = [
  "szarszerver", "fosszerver", "hulladekszerver", "szutyokszerver", "szennyszerver",
  "szaradmin", "fosadmin", "bohocadmin", "retkesadmin", "szutyokadmin",
  "szarstaff", "fosstaff", "bohocstaff", "retkesstaff",
  "szarrendszer", "fosrendszer", "hulladekrendszer", "szennyrendszer",
  "viccszerver", "viccstaff", "viccadmin",

  "szar admin", "fos admin", "bohóc admin", "retkes admin", "szutyok admin",
  "szar adminok", "fos adminok", "bohóc adminok", "retkes adminok",
  "szutyok adminok", "hulladék adminok",

  "szar adminisztrátor", "fos adminisztrátor", "bohóc adminisztrátor", "retkes adminisztrátor",
  "szar adminsegéd", "fos adminsegéd", "bohóc adminsegéd", "retkes adminsegéd",
  "szar manager", "fos manager", "bohóc manager", "retkes manager",
  "szar tulaj", "fos tulaj", "bohóc tulaj", "retkes tulaj",
  "szar tulajdonos", "fos tulajdonos", "bohóc tulajdonos", "retkes tulajdonos",
  "szar vezetőség", "fos vezetőség", "bohóc vezetőség", "retkes vezetőség",

  "szar admin csapat", "fos admin csapat", "bohóc admin csapat", "retkes admin csapat",
  "szar admin brigád", "fos admin brigád",
  "szar manager csapat", "fos manager csapat",
  "szar tulaj csapat", "fos tulaj csapat",
  "szar vezető csapat", "fos vezető csapat",

  "ez egy szar admin csapat",
  "ez egy fos admin csapat",
  "ez egy bohóc admin csapat",
  "ez egy hulladék admin csapat",

  "adminok egy vicc", "adminok egy szar", "adminok egy fos", "adminok egy bohóc banda",
  "adminisztrátorok egy vicc",
  "adminsegédek egy vicc",
  "managerek egy vicc",
  "tulajdonosok egy vicc",
  "vezetőség egy vicc",

  "admin rendszer szar",
  "admin rendszer fos",
  "admin rendszer hulladék",
  "admin rendszer vicc",
  "admin rendszer szutyok"
];

const THREAT_WORDS = [
  "megollek", "megöllek",
  "megverlek",
  "szetszedlek", "szétszedlek",
  "kinyirlak", "kinyírlak",
  "elkaplak",
  "megtalallak", "megtalállak",
  "kicsinallak", "kicsinállak",
  "szétverlek", "agyonverlek",
  "pofán váglak", "megütlek",
  "szétbaszlak", "szétcsaplak",
  "megbaszlak",
  "kicsinállak most",
  "véged lesz", "nem úszod meg",
  "elkaplak kint", "meglátlak kint", "megkereslek kint",
  "megverlek majd", "megöllek majd", "szétbaszlak majd",
  "meg foglak találni", "meg foglak verni",
  "szét foglak verni", "agyon foglak verni",
  "nem lesz jó vége", "rossz vége lesz",
  "meg fogsz dögleni", "megdöglesz",
 "kivégezlek",
  "kicsinállak este",
  "elkaplak este",
  "nem éled túl",
  "szét lesz verve a fejed",
  "agyon leszel verve"
];

const RP_CONTEXT_WORDS = [
  "rp", "szitu", "szituba", "szituban", "jelenet", "jelenetben",
  "helyszín", "helyszínre",
  "városháza", "városházánál",
  "korház", "kórház",
  "mentő", "mentők", "orvos",
  "rendőr", "rendőrök", "sheriff", "bcso", "ems",
  "lelőttek", "meglőttek", "megöltek", "meghaltam", "meghalt",
  "kidőltem", "elvéreztem",
  "elraboltak", "kiraboltak", "elütöttek",
  "leszúrtak", "megvertek", "összevertek",
  "elkapott", "lefogtak",
  "baleset", "karambol", "üldözés", "lövöldözés", "túsz", "rablás", "intézkedés"
];

const ACTIVE_THREAT_PATTERNS = [
  /\b(megöllek|meg foglak ölni|megverlek|agyonverlek|szétverlek|szétbaszlak|kicsinállak|elintézlek)\b/i,
  /\b(meg fogsz halni|megdöglesz|véged lesz|nem úszod meg|nem fogod megúszni)\b/i,
  /\b(megtalállak|megkereslek|elkaplak|utolérlek|megvárlak)\b.{0,20}\b(kint|majd|este|holnap|egyszer)\b/i,
  /\b(szét foglak verni|agyon foglak verni|meg foglak találni|meg foglak verni)\b/i,
];

const PASSIVE_RP_EVENT_PATTERNS = [
  /\b(megöltek|lelőttek|meglőttek|megvertek|összevertek|leszúrtak|elraboltak|kiraboltak)\b/i,
  /\b(meghaltam|meghalt|kidőltem|elvéreztem|elpakoltak|elintéztek)\b/i,
  /\b(kaptam egy fejlövést|kilőttek|kiszedtek|lefogtak|bevittek)\b/i,
];

const RACIST_CONTEXT_PATTERNS = [
  /\b(te|ti|ezek|azok|mocskos|rohadt|retkes|büdös)\b.{0,12}\b(cigány|roma)\b/i,
  /\b(cigány|roma)\b.{0,12}\b(féreg|kutya|patkány|szar|szutyok|retkes|büdös|mocskos)\b/i,
  /\b(cigányok|romák)\b.{0,16}\b(takarodjatok|dögöljetek|rohadtak|férgek|szemetek)\b/i,
  /\b(büdös cigány|retkes cigány|mocskos cigány|rohadt cigány)\b/i
];

const RACIST_SOFT_CONTEXT_PATTERNS = [
  /\b(cigányozás|romázás)\b/i,
  /\b(cigány|roma)\b.{0,12}\b(megint|tipikus|persze|nyilván)\b/i
];
function isHateSlur(content = "") {
  const raw = String(content || "").toLowerCase();
  return HATE_SLUR_WORDS.some((word) => raw.includes(word.toLowerCase()));
}

function isRacistAbuse(content = "") {
  const raw = String(content || "");
  return (
    RACIST_CONTEXT_PATTERNS.some((p) => p.test(raw)) ||
    isHateSlur(raw)
  );
}
function hasRpContext(content = "") {
  const text = normalizeModerationText(content);
  return containsCanonical(text, RP_CONTEXT_WORDS);
}

function isPassiveRpEvent(content = "") {
  const raw = String(content || "");
  return PASSIVE_RP_EVENT_PATTERNS.some((p) => p.test(raw));
}

function isActiveThreat(content = "") {
  const raw = String(content || "");
  return ACTIVE_THREAT_PATTERNS.some((p) => p.test(raw));
}

function isRpSafeViolenceContext(content = "") {
  const raw = String(content || "");
  const rpContext = hasRpContext(raw);
  const passiveEvent = isPassiveRpEvent(raw);
  const activeThreat = isActiveThreat(raw);

  if (activeThreat) return false;
  if (passiveEvent) return true;
  if (rpContext && /\b(megöltek|lelőttek|lelőttek|meglőttek|meghaltam|meghalt|megvertek|kiraboltak|elraboltak|leszúrtak)\b/i.test(raw)) {
    return true;
  }

  return false;
}

function isRacistAbuse(content = "") {
  const raw = String(content || "");
  return RACIST_CONTEXT_PATTERNS.some((p) => p.test(raw));
}

function isSoftRacistFriction(content = "") {
  const raw = String(content || "");
  return RACIST_SOFT_CONTEXT_PATTERNS.some((p) => p.test(raw));
}
function canonicalCharMap(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[2]/g, "z")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[6]/g, "g")
    .replace(/[7]/g, "t")
    .replace(/[8]/g, "b")
    .replace(/[9]/g, "g");
}

function normalizeModerationText(text = "", options = {}) {
  const { compact = false } = options;

  let t = canonicalCharMap(text).replace(/([a-z])\1{2,}/g, "$1$1");

  if (compact) {
    return t.replace(/[^a-z0-9]/g, "");
  }

  return t
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTerm(term = "") {
  return normalizeModerationText(term, { compact: true });
}

function containsCanonical(content = "", terms = []) {
  const compact = normalizeModerationText(content, { compact: true });

  return terms.some((term) => {
    const needle = canonicalTerm(term);
    return needle && compact.includes(needle);
  });
}

function collectCanonicalHits(content = "", terms = [], limit = 8) {
  const compact = normalizeModerationText(content, { compact: true });
  const hits = [];

  for (const term of terms) {
    const needle = canonicalTerm(term);
    if (!needle) continue;

    if (compact.includes(needle)) {
      hits.push(term);
      if (hits.length >= limit) break;
    }
  }

  return hits;
}

function containsFromWordList(content = "", words = []) {
  return containsCanonical(content, words);
}

function matchesAnyPattern(content = "", patterns = []) {
  const raw = String(content || "");
  const normalizedLoose = normalizeModerationText(content);
  const normalizedCompact = normalizeModerationText(content, { compact: true });

  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return (
      pattern.test(raw) ||
      pattern.test(normalizedLoose) ||
      pattern.test(normalizedCompact)
    );
  });
}

const MILD_PROFANITY_PATTERNS = [
  /\b(a\s+kurva\s+elet|a\s+kurva\s+eletbe|az\s+istenit|a\s+mindenit)\b/i,
  /\b(lofasz|lófasz|faszom\s+kivan|tele\s+van\s+a\s+faszom)\b/i,
];

const INSULT_PATTERNS = [
  /\b(kurva\s+any[aá]d|a\s+kurva\s+any[aá]d)\b/i,
  /\b(d[oö]g[oö]lj\s+meg|dogolj\s+meg|rohadj\s+meg|pusztulj(\s+el)?)\b/i,
  /\b(te\s+nyomor[eé]k|te\s+retkes|te\s+csicska|te\s+barom|te\s+boh[oó]c)\b/i,
  /\b(szarh[aá]zi|semmirekell[oő]|faszfej|faszkalap|gecifej|geciarc)\b/i,
];

function containsMildProfanity(content = "") {
  return (
    containsFromWordList(content, MILD_PROFANITY_WORDS) ||
    matchesAnyPattern(content, MILD_PROFANITY_PATTERNS)
  );
}

function containsInsultWord(content = "") {
  return (
    containsFromWordList(content, INSULT_WORDS) ||
    containsFromWordList(content, FAMILY_INSULT_WORDS) ||
    containsFromWordList(content, STAFF_ABUSE_WORDS) ||
    containsFromWordList(content, THREAT_WORDS) ||
    matchesAnyPattern(content, INSULT_PATTERNS)
  );
}

function containsTargetWord(content = "") {
  return containsCanonical(content, TARGET_WORDS);
}

function isContextualProfanity(content = "") {
  const raw = String(content || "");
  const normalized = normalizeModerationText(raw);

  // RP / eseményjelentés sose legyen "mild profanity"
  if (isRpSafeViolenceContext(raw)) {
    return false;
  }

  // aktív fenyegetés nem mild kategória
  if (isActiveThreat(raw)) {
    return false;
  }

  // rasszista célzott beszólás nem mild kategória
  if (isRacistAbuse(raw)) {
    return false;
  }

  if (!containsMildProfanity(normalized) && !containsInsultWord(normalized)) {
    return false;
  }

  if (containsTargetWord(normalized)) {
    return false;
  }

  if (
    /\b(te|ti|neked|nektek|o|ok|ez a|olyan vagy|vagytok|takarodj|kuss)\b/i.test(normalized)
  ) {
    return false;
  }

  // etnikai szó önmagában ne menjen trágárnak
  if (
    /\b(cigány|roma|cigányok|romák)\b/i.test(normalized) &&
    !isSoftRacistFriction(normalized) &&
    !isRacistAbuse(normalized)
  ) {
    return false;
  }

  return true;
}

function isTargetedDegradingMessage(content = "") {
  const normalizedLoose = normalizeModerationText(content);
  const normalizedCompact = normalizeModerationText(content, { compact: true });

  if (!normalizedCompact) return false;

  const strongTargetPatterns = [
    /\b(szerver|server|internalgaming)\b.{0,18}\b(szar|fos|hulladek|szutyok|szenny|bohoc|vicc|retkes|nyomorek)\b/i,
    /\b(admin|adminok|staff|moderator|fejleszto|vezetoseg)\b.{0,18}\b(szar|fos|hulladek|szutyok|szenny|bohoc|vicc|retkes|nyomorek)\b/i,
    /\b(szar|fos|hulladek|szutyok|szenny|bohoc|vicc|retkes|nyomorek)\b.{0,18}\b(szerver|server|internalgaming|admin|adminok|staff|moderator|fejleszto|vezetoseg)\b/i,
  ];

  if (strongTargetPatterns.some((p) => p.test(normalizedLoose))) return true;
  if (containsCanonical(content, STAFF_ABUSE_WORDS)) return true;

  return containsInsultWord(content) && containsTargetWord(content);
}
function isTargetedInsult(content = "") {
  const raw = String(content || "");
  const normalizedLoose = normalizeModerationText(raw);
  const normalizedCompact = normalizeModerationText(raw, { compact: true });

  if (!normalizedCompact) return false;

  const targetedPatterns = [
    /\b(te|ti|neked|nektek|rólad|rolad|róluk|roluk|vagy|vagytok)\b.{0,20}\b(nyomorek|retkes|patkany|patkány|semmirekello|semmirekellő|szarhazi|szarházi|csicska|idiota|idióta|hulye|hülye|balfasz|faszfej|faszkalap|gecifej|geciarc|szarfej|szararc|fosfej|fosarc|bohoc|bohóc|majom|barom|diszno|disznó|korcs|fattyu|fattyú|ribanc|lotyo|lotyó|ringyo|ringyó|cafka|pszichopata|elmebeteg|orult|őrült|zakkant|bolond|undorito|undorító|gusztustalan|hanyadek|hányadék|okadek|okádék|szutyok|szenny|mocsok)\b/i,
    /\b(nyomorek|retkes|patkany|patkány|semmirekello|semmirekellő|szarhazi|szarházi|csicska|idiota|idióta|hulye|hülye|balfasz|faszfej|faszkalap|gecifej|geciarc|szarfej|szararc|fosfej|fosarc|bohoc|bohóc|majom|barom|diszno|disznó|korcs|fattyu|fattyú|ribanc|lotyo|lotyó|ringyo|ringyó|cafka|pszichopata|elmebeteg|orult|őrült|zakkant|bolond|undorito|undorító|gusztustalan|hanyadek|hányadék|okadek|okádék|szutyok|szenny|mocsok)\b.{0,20}\b(te|ti|neked|nektek|rólad|rolad|róluk|roluk|vagy|vagytok)\b/i,
    /\b(admin|adminok|staff|moderator|moderátor|fejleszto|fejlesztő|vezetoseg|vezetőség|szerver|server|rendszer|kozosseg|közösség|internalgaming)\b.{0,20}\b(bohoc|bohóc|vicc|szanalmas|nevetseges|nevetséges|komolytalan|retkes|nyomorek|szutyok|szenny|hulladek|hulladék)\b/i,
    /\b(bohoc|bohóc|vicc|szanalmas|nevetseges|nevetséges|komolytalan|retkes|nyomorek|szutyok|szenny|hulladek|hulladék)\b.{0,20}\b(admin|adminok|staff|moderator|moderátor|fejleszto|fejlesztő|vezetoseg|vezetőség|szerver|server|rendszer|kozosseg|közösség|internalgaming)\b/i,
  ];

  if (matchesAnyPattern(raw, targetedPatterns)) return true;

  const hasInsult = containsInsultWord(raw);
  const hasTarget = containsTargetWord(raw);

  if (hasInsult && hasTarget) {
    return true;
  }

  return false;
}

function isStrongDirectAbuse(content = "") {
  const raw = String(content || "");
  const normalizedLoose = normalizeModerationText(raw);
  const normalizedCompact = normalizeModerationText(raw, { compact: true });

  if (!normalizedCompact) return false;

  const strongPatterns = [
    /\b(kurva\s+anyad|a\s+kurva\s+anyad|dogolj\s+meg|dögölj\s+meg|rohadj\s+meg|pusztulj)\b/i,
    /\b(te|ti|neked|nektek|vagy|vagytok)\b.{0,12}\b(kurva|geci|fasz|anyad|szarhazi|szarházi|csicska|faszfej|faszkalap|balfasz)\b/i,
    /\b(kurva|geci|fasz|anyad|szarhazi|szarházi|csicska|faszfej|faszkalap|balfasz)\b.{0,12}\b(te|ti|neked|nektek|vagy|vagytok)\b/i,
  ];

  if (matchesAnyPattern(raw, strongPatterns)) return true;

  const hasFamilyInsult = containsCanonical(raw, FAMILY_INSULT_WORDS);
  if (hasFamilyInsult) return true;

  return false;
}
function detectBypassPatterns(content = "") {
  const raw = String(content || "");
  const normalizedLoose = normalizeModerationText(raw);
  const normalizedCompact = normalizeModerationText(raw, { compact: true });

  let score = 0;
  const hits = [];

  const familyHits = collectCanonicalHits(raw, FAMILY_INSULT_WORDS, 3);
  const insultHits = collectCanonicalHits(raw, INSULT_WORDS, 5);
  const staffHits = collectCanonicalHits(raw, STAFF_ABUSE_WORDS, 4);
  const threatHits = collectCanonicalHits(raw, THREAT_WORDS, 3);

  if (familyHits.length) {
    hits.push("Obfuszkált családi sértés");
    score += 16;
  }

  if (insultHits.length) {
    hits.push("Obfuszkált sértés");
    score += 12;
  }

  if (staffHits.length) {
    hits.push("Obfuszkált szerver / staff szidalmazás");
    score += 14;
  }

  if (threatHits.length) {
    hits.push("Obfuszkált fenyegetés");
    score += 16;
  }

  if (/(?:[a-zA-ZÁ-Űá-ű0-9][\s._,\-~*|`'"]){2,}[a-zA-ZÁ-Űá-ű0-9]/.test(raw)) {
    hits.push("Széthúzott karakteres megkerülés");
    score += 6;
  }

  if (/([a-zA-ZÁ-Űá-ű])\1{3,}/.test(raw)) {
    hits.push("Nyújtott karakteres megkerülés");
    score += 5;
  }

  if (
    /[0134578@$!|]/.test(raw) &&
    (familyHits.length || insultHits.length || staffHits.length || threatHits.length)
  ) {
    hits.push("Leetspeak megkerülés");
    score += 5;
  }

  if (
    normalizedCompact.length >= 8 &&
    normalizedCompact !== normalizedLoose.replace(/\s+/g, "")
  ) {
    hits.push("Összerántott / tisztított obfuszkáció");
    score += 3;
  }

  return {
    score,
    hits: [...new Set(hits)],
    normalized: normalizedCompact,
  };
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
    key: "watch",
    points: 8,
    label: "Nyers, trágár megfogalmazás",
  });
  score += 8;
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
- A string mezőkben ne használj idézőjelet, se dupla idézőjelet, se magyar idézőjelet.
- Ha az üzenetből példát említesz, idézőjelek helyett sima szövegként írd le.
- Csak érvényes JSON-t adj vissza.

{
  "category": "harassment | threat | staff_abuse | doxxing | nsfw | ad_server | spam | flood | ooc_trade | scam | ban_evasion | politics_sensitive | clean | other",
  "categoryHu": "magyar kategórianév",
  "severity": "enyhe | közepes | magas | kritikus",
  "confidence": 0-100,
  "points": 0-160,
  "ruleBroken": "rövid szabályleírás",
  "reason": "rövid indoklás",
  "analysis": "max 3 mondat",
  "patternSummary": "rövid összegzés",
  "recommendedAction": "ignore | watch | warn | delete | timeout | kick | ban",
  "timeoutMinutes": 0,
  "shouldNotifyStaff": true
}
`;

  try {
const response = await openai.chat.completions.create({
  model: CONFIG.AI_MODEL,
  messages: [
    {
      role: "system",
      content:
        "Csak érvényes JSON objektummal válaszolj. Ne írj magyarázatot a JSON elé vagy mögé.",
    },
    {
      role: "user",
      content: prompt,
    },
  ],
});

const content =
  response.choices?.[0]?.message?.content?.trim() || "{}";

return safeParseAiModeration(content);
  } catch (error) {
    console.error("[AIMOD] aiAnalyzeModeration hiba:", error);

    return getDefaultAiModerationResult();
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
  const suspicion = getSuspicionValue(profile);
  const summaries = summarizeIncidents(profile);
  const previousMessages = getPreviousProblemMessages(
    profile,
    profile.activeCase?.lastMessageId || null
  );

  const active = profile.activeCase || {};
  const liveRisk = getRiskPercent(profile);
  profile.behaviorScore = liveRisk;

  const quotedMessage = trimField(active.lastMessageContent || "-", 220);
  const metaNote = trimField(active.lastEvidence || "-", 700);

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
        `**Kategória:** **${trimField(active.lastCategory || "Egyéb", 128)}**`,
      ].join("\n")
    )
    .addFields(
      {
        name: "🧠 AI elemzés",
        value: trimField(active.lastAnalysis || "Nincs elemzés.", 1024),
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
          `Üzenet:\n>>> ${quotedMessage}\n` +
          `Csatorna: ${active.lastChannelId ? `<#${active.lastChannelId}>` : "-"}\n` +
          `Megjegyzés:\n${metaNote}`,
        inline: false,
      },
{
  name: "📦 Előzmények (30 nap)",
  value: `${summaries.thirty}`,
  inline: false,
},
      {
        name: "🧾 Korábbi problémás üzenetek",
        value: trimField(previousMessages, 1024),
        inline: false,
      },
      {
        name: "📊 Kockázat",
        value: formatRiskBlock(profile),
        inline: false,
      }
    )
    .setFooter({ text: `AI Moderation • ${CONFIG.SERVER_NAME}` })
    .setTimestamp(new Date(active.lastUpdatedAt || Date.now()));
}
async function logWatchIncident(client, message, member, profile, final) {
  try {
    const logChannel = await getLogChannel(client);
    if (!logChannel || !member) return null;

    const embed = new EmbedBuilder()
      .setColor(0xf0c419)
      .setTitle("👁️ Watch / megfigyelés log")
      .addFields(
        {
          name: "Felhasználó",
          value: `${member.user?.tag || member.user?.username || "Ismeretlen"} (${member.id})`,
          inline: false,
        },
        {
          name: "Művelet",
          value: actionToLabel(final.action),
          inline: true,
        },
        {
          name: "Kategória",
          value: final.categoryHu || categoryToHu(final.category),
          inline: true,
        },
        {
          name: "Súlyosság",
          value: final.severity || "enyhe",
          inline: true,
        },
        {
          name: "Indok",
          value: trimField(final.ruleBroken || final.reason || "Watch esemény", 1024),
          inline: false,
        },
        {
          name: "Üzenet",
          value: trimField(message?.content || "-", 1024),
          inline: false,
        },
        {
          name: "Csatorna",
          value: message?.channel ? `<#${message.channel.id}>` : "-",
          inline: true,
        },
        {
          name: "Risk",
          value: `${Math.round(Number(profile.behaviorScore || getRiskPercent(profile) || 0))}%`,
          inline: true,
        },
        {
          name: "Watch végéig",
          value:
            Number(profile.watchUntil || 0) > Date.now()
              ? `<t:${Math.floor(profile.watchUntil / 1000)}:R>`
              : "Nincs aktív watch",
          inline: true,
        }
      )
      .setTimestamp(new Date());

    const oldWatchMessageId = store.watchMessages?.[member.id];
    if (oldWatchMessageId) {
      const oldMsg = await logChannel.messages.fetch(oldWatchMessageId).catch(() => null);
      if (oldMsg) {
        const edited = await oldMsg.edit({
          embeds: [embed],
        }).catch(() => null);

        if (edited) {
          store.watchMessages[member.id] = edited.id;
          saveStore();
          return edited;
        }
      }
    }

    const sent = await logChannel.send({
      embeds: [embed],
    }).catch(() => null);

    if (sent) {
      if (!store.watchMessages) store.watchMessages = {};
      store.watchMessages[member.id] = sent.id;
      saveStore();
    }

    return sent;
  } catch (error) {
    console.error("[AIMOD] watch log hiba:", error);
    return null;
  }
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
  if (!logChannel || !member?.id) return null;

  if (!store.caseMessages) {
    store.caseMessages = {};
  }

  const oldMessageId = store.caseMessages[member.id];
  if (oldMessageId) {
    const oldMsg = await logChannel.messages.fetch(oldMessageId).catch(() => null);
    if (oldMsg) {
      await oldMsg.delete().catch(() => null);
    }
    delete store.caseMessages[member.id];
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
function getManualModerationPreset(action) {
  switch (action) {
    case "timeout":
      return {
        points: 12,
        suspicion: 8,
        severity: "közepes",
        category: "Manuális moderáció",
        actionLabel: "Timeout / mute",
      };
    case "kick":
      return {
        points: 22,
        suspicion: 14,
        severity: "magas",
        category: "Manuális moderáció",
        actionLabel: "Kick",
      };
    case "ban":
      return {
        points: 35,
        suspicion: 20,
        severity: "kritikus",
        category: "Manuális moderáció",
        actionLabel: "Ban",
      };
    case "unban":
      return {
        points: -20,
        suspicion: -10,
        severity: "enyhe",
        category: "Manuális moderáció",
        actionLabel: "Feloldás / unban",
      };
    default:
      return {
        points: 0,
        suspicion: 0,
        severity: "enyhe",
        category: "Manuális moderáció",
        actionLabel: "Ismeretlen művelet",
      };
  }
}

async function applyManualModerationAndLog(client, member, options = {}) {
  if (!member?.id) return null;

  const {
    action = "timeout",
    moderatorTag = "Ismeretlen",
    reason = "",
    durationText = "",
    source = "Kézi moderáció",
  } = options;

  const preset = getManualModerationPreset(action);
  const profile = getUserProfile(member.id);

  const oldRisk = getRiskPercent(profile);

  if (action === "unban") {
    profile.suspicion = Math.max(0, Number(profile.suspicion || 0) + preset.suspicion);
    profile.behaviorScore = getRiskPercent(profile);
    profile.totals.unbans = (profile.totals.unbans || 0) + 1;

    profile.activeCase = {
      ...(profile.activeCase || {}),
      lastAction: preset.actionLabel,
      lastActionRaw: "unban",
      lastReason: reason || "Kézi unban",
      lastCategory: preset.category,
      lastSeverity: preset.severity,
      lastAnalysis: `${source}: ${moderatorTag} feloldotta a felhasználó szankcióját.`,
      lastPatternSummary: "Kézi moderációs feloldás történt.",
      lastRuleBroken: "Manuális staff döntés",
      lastMessageContent: "",
      lastMessageId: null,
      lastChannelId: null,
      lastProjectedRisk: getRiskPercent(profile),
      lastEvidence: `Moderátor: ${moderatorTag}${reason ? `\nIndok: ${reason}` : ""}`,
      lastModerationMode: "manual",
      lastUpdatedAt: Date.now(),
      currentStatus: "Feloldva",
    };

    saveStore();
    await resendUnifiedCaseMessage(client, member, profile).catch(() => null);

    return {
      profile,
      oldRisk,
      newRisk: getRiskPercent(profile),
      addedPoints: preset.points,
    };
  }

  addIncident(member.id, {
    createdAt: Date.now(),
    points: preset.points,
    suspicion: preset.suspicion,
    action,
    severity: preset.severity,
    category: preset.category,
    content: `${source}: ${preset.actionLabel}`,
    reason: reason || "",
    moderatorTag,
    source,
  });

  if (action === "timeout") {
    profile.totals.timeouts = (profile.totals.timeouts || 0) + 1;
  } else if (action === "kick") {
    profile.totals.kicks = (profile.totals.kicks || 0) + 1;
  } else if (action === "ban") {
    profile.totals.bans = (profile.totals.bans || 0) + 1;
  }

  const newRisk = getRiskPercent(profile);
  profile.behaviorScore = newRisk;
  profile.suspicion = Math.max(0, Number(profile.suspicion || 0));

  profile.activeCase = {
    ...(profile.activeCase || {}),
    lastAction: preset.actionLabel,
    lastActionRaw: action,
    lastReason: reason || "Kézi staff döntés",
    lastCategory: preset.category,
    lastSeverity: preset.severity,
    lastAnalysis:
      `${source}: ${moderatorTag} ${preset.actionLabel.toLowerCase()} intézkedést adott.` +
      `${durationText ? ` Időtartam: ${durationText}.` : ""}` +
      ` A rendszer ${preset.points} pontot adott hozzá a kockázathoz.`,
    lastPatternSummary: "Kézi moderációs intézkedés történt.",
    lastRuleBroken: "Manuális staff döntés",
    lastMessageContent: "",
    lastMessageId: null,
    lastChannelId: null,
    lastProjectedRisk: newRisk,
    lastEvidence:
      `Moderátor: ${moderatorTag}` +
      `${durationText ? `\nIdőtartam: ${durationText}` : ""}` +
      `${reason ? `\nIndok: ${reason}` : ""}`,
    lastModerationMode: "manual",
    lastUpdatedAt: Date.now(),
    currentStatus: actionToLabel(action),
  };

  saveStore();
  await resendUnifiedCaseMessage(client, member, profile).catch(() => null);

  return {
    profile,
    oldRisk,
    newRisk,
    addedPoints: preset.points,
  };
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
          name: "📊 Kockázat",
          value: formatRiskBlock(profile),
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

if (final.action === "delete") {
  if (message?.deletable) {
    const deleted = await safeDeleteMessage(message).catch(() => false);

    if (deleted) {
      profile.totals.deletions = (profile.totals.deletions || 0) + 1;
      performed = true;
    }
  }

  if (performed) {
    await sendSingleUserNotice({
      message,
      member,
      profile,
      final,
    }).catch(() => null);
  }

  return performed;
}

if (final.action === "watch") {
  extendWatch(profile);

  profile.suspicion = Math.max(
    0,
    Number(profile.suspicion || 0) + Number(final.suspicionGain || CONFIG.WATCH_BASE_POINTS)
  );

  profile.behaviorScore = getRiskPercent(profile);

  addIncident(member.id, {
    type: "watch",
    category: final.category || "other",
    severity: final.severity || "enyhe",
    points: Number(final.points || CONFIG.WATCH_BASE_POINTS),
    suspicion: Number(final.suspicionGain || 6),
    reason: final.reason || "Watch esemény",
    ruleBroken: final.ruleBroken || "Watch esemény",
    content: cleanText(message.content || "", 400),
    messageId: message.id,
    channelId: message.channelId,
    createdAt: Date.now(),
  });

  profile.activeCase = {
    ...(profile.activeCase || {}),
    lastAction: actionToLabel(final.action),
    lastActionRaw: "watch",
    lastReason: final.reason || "",
    lastCategory: final.categoryHu || categoryToHu(final.category),
    lastSeverity: final.severity || "enyhe",
    lastAnalysis: final.analysis || "",
    lastPatternSummary: final.patternSummary || "",
    lastRuleBroken: final.ruleBroken || "",
    lastMessageContent: cleanText(message.content || "", 500),
    lastMessageId: message.id,
    lastChannelId: message.channelId,
    lastProjectedRisk: getRiskPercent(profile),
    lastEvidence:
      `Csatorna: ${message.channel ? `<#${message.channel.id}>` : "-"}\n` +
      `Pont: ${Number(final.points || CONFIG.WATCH_BASE_POINTS)}\n` +
      `Risk: ${getRiskPercent(profile)}%\n` +
      `Watch vége: ${
        profile.watchUntil > Date.now()
          ? `<t:${Math.floor(profile.watchUntil / 1000)}:R>`
          : "nincs"
      }`,
    lastUpdatedAt: Date.now(),
    currentStatus: "Megfigyelés / watch",
  };

  saveStore();

  await sendSingleUserNotice({ message, member, profile, final }).catch(() => null);
  await resendUnifiedCaseMessage(client, member, profile).catch(() => null);

  return;
}

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

  const dmSent = await sendKickDM(member.user, final, member, message, profile).catch(() => false);

  const ok = await safeKick(member, reasonText);
  if (ok) {
    profile.totals.kicks = (profile.totals.kicks || 0) + 1;
    profile.suspicion = Math.max(
      0,
      Number(profile.suspicion || 0) + Number(final.suspicionGain || 0) + 10
    );

    console.log(
      `[AIMOD] Kick DM állapot ${member.user?.tag || member.id}: ${dmSent ? "elküldve" : "nem sikerült"}`
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

    const shield = falsePositiveShield(
      message,
      ruleScan,
      contextMessages,
      replyTarget
    );

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
        severity:
          ruleScan.score >= 70
            ? "magas"
            : ruleScan.score >= 35
              ? "közepes"
              : "enyhe",
        confidence: Math.min(95, 35 + ruleScan.score),
        points: ruleScan.score,
        ruleBroken:
          pickHighestRuleHit(ruleScan.hits)?.label || "Szabályszegés gyanú",
        reason: "A szabályalapú ellenőrzés problémás mintát talált.",
        analysis:
          "A rendszer AI nélkül is egyértelmű szabálytalansági mintát talált a tartalomban.",
        patternSummary: "Szabályalapú minta alapján detektált tartalom.",
        recommendedAction:
          ruleScan.score >= 65
            ? "timeout"
            : ruleScan.score >= 25
              ? "delete"
              : "warn",
        timeoutMinutes: 0,
        shouldNotifyStaff: ruleScan.score >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG,
      };
    } else {
      return;
    }

    const currentRisk = getRiskPercent(profile);
    const currentSuspicion = getSuspicionValue(profile);
const immediateDecision = buildImmediateRuleDecision(message, profile);

if (immediateDecision) {
  let forcedAction = immediateDecision.action;

  if (getState("aimod_safe_mode")) {
    forcedAction = capActionForSafeMode(forcedAction);
  }

  const final = {
    action: normalizeExclusiveAction(forcedAction),
    category: immediateDecision.category,
    categoryHu: immediateDecision.categoryHu,
    severity: immediateDecision.severity,
    confidence: immediateDecision.confidence,
    points: immediateDecision.points,
    projectedRisk: Math.min(100, currentRisk + immediateDecision.points),
    suspicionGain: immediateDecision.suspicionGain,
    ruleBroken: immediateDecision.ruleBroken,
    reason: immediateDecision.reason,
    analysis: immediateDecision.analysis,
    patternSummary: immediateDecision.patternSummary,
    timeoutMinutes:
      forcedAction === "timeout"
        ? getDynamicTimeoutMinutes({
            severity: immediateDecision.severity,
            points: immediateDecision.points,
            projectedRisk: Math.min(100, currentRisk + immediateDecision.points),
            suspicion: currentSuspicion + immediateDecision.suspicionGain,
            profile,
            safeMode: getState("aimod_safe_mode"),
          })
        : 0,
    shouldNotifyStaff: true,
  };

  if (immediateDecision.forceWatch) {
    extendWatch(profile);
  }

  await applyModerationDecision(client, message, profile, final);
  return;
}
    // =========================
    // KÜLÖN ÁG: CÉLZOTT OBSZCÉN MINŐSÍTÉS
    // =========================
    if (isTargetedDegradingMessage(message.content || "")) {
      const repeatCount = countRecentTargetedInsults(
        profile,
        message.content || ""
      );

let forcedAction = "delete";
let severity = "közepes";
let points = 52;
let suspicionGain = 14;

if (repeatCount >= 1) {
  forcedAction = "delete";
  severity = "közepes";
  points = 58;
  suspicionGain = 16;
}

if (repeatCount >= 2) {
  forcedAction = "timeout";
  severity = "közepes";
  points = 68;
  suspicionGain = 20;
}

if (repeatCount >= 4) {
  forcedAction = "kick";
  severity = "magas";
  points = 84;
  suspicionGain = 26;
}

if (repeatCount >= 6) {
  forcedAction = "ban";
  severity = "kritikus";
  points = 96;
  suspicionGain = 32;
}

      if (getState("aimod_safe_mode")) {
        if (forcedAction === "ban") forcedAction = "kick";
        else if (forcedAction === "kick") forcedAction = "timeout";
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

      const final = {
        action: normalizeExclusiveAction(forcedAction),
        category: "staff_abuse",
        categoryHu: "Célzott szidalmazás / minősítés",
        severity,
        confidence: 92,
        points,
        projectedRisk: currentRisk,
        suspicionGain,
        ruleBroken: "Célzott obszcén minősítés vagy szidalmazás.",
        reason:
          "A rendszer célzott, sértő minősítést talált valakire vagy valamire.",
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
        bypassScore: Number(bypass?.score || 0),
        replyTarget: replyTarget?.targetTag || "",
        timeoutMinutes,
        behaviorLabels: [],
      };

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
        lastEvidence: buildEvidenceText(
          message,
          ruleScan,
          final,
          bypass,
          replyTarget
        ),
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

      if (
        final.shouldNotifyStaff ||
        final.points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG
      ) {
        await resendUnifiedCaseMessage(client, member, profile).catch(() => null);
      }

      return;
    }

    // =========================
    // KÜLÖN ÁG: ENYHE, NEM CÉLZOTT TRÁGÁRSÁG
    // =========================
    if (
      !isTargetedDegradingMessage(message.content || "") &&
      isContextualProfanity(message.content || "")
    ) {
      const mildRepeatCount = (profile.recentMessages || []).filter((m) => {
        const sameWindow =
          Date.now() - Number(m.createdAt || 0) <= 10 * 60 * 1000;
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

      if (getState("aimod_safe_mode") && forcedAction === "timeout") {
        forcedAction = "delete";
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

      const final = {
        action: normalizeExclusiveAction(forcedAction),
        category: "harassment",
        categoryHu: "Nyers, trágár kommunikáció",
        severity,
        confidence: 84,
        points,
        projectedRisk: currentRisk,
        suspicionGain,
        ruleBroken: "Indokolatlanul trágár kommunikáció.",
        reason:
          "A rendszer nem célzott, de nyers és közösségromboló megfogalmazást talált.",
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
        behaviorLabels: [],
      };

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
        lastEvidence: buildEvidenceText(
          message,
          ruleScan,
          final,
          bypass,
          replyTarget
        ),
        lastModerationMode: final.moderationMode,
        lastShieldReason: final.shieldReason,
        lastBypassScore: final.bypassScore,
        lastReplyTarget: final.replyTarget,
        currentStatus:
          final.action === "timeout"
            ? "Időkorlátozva"
            : final.action === "delete"
              ? "Üzenet törölve"
              : "Figyelmeztetve",
      });

      saveStore();

      if (
        final.shouldNotifyStaff ||
        final.points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG
      ) {
        await resendUnifiedCaseMessage(client, member, profile).catch(() => null);
      }

      return;
    }

    // =========================
    // NORMÁL ÁG
    // =========================
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
          lastEvidence: buildEvidenceText(
            message,
            ruleScan,
            final,
            bypass,
            replyTarget
          ),
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
      lastEvidence: buildEvidenceText(
        message,
        ruleScan,
        final,
        bypass,
        replyTarget
      ),
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

    if (
      final.shouldNotifyStaff ||
      final.points >= CONFIG.MIN_INCIDENT_SCORE_FOR_LOG
    ) {
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
  const topRuleHits = (ruleScan.hits || [])
    .slice(0, 3)
    .map((h) => h.label);

  const bypassHits = (bypass?.hits || []).slice(0, 3);

  return cleanText(
    [
      topRuleHits.length
        ? `Fő találatok: ${topRuleHits.join(", ")}`
        : "Fő találat: nincs",
      `Pont: ${Number(final.points || 0)}`,
      `Bizalom: ${Number(final.confidence || 0)}%`,
      `Várható risk: ${Number(final.projectedRisk || 0)}%`,
      `Bypass: ${
        bypassHits.length
          ? bypassHits.join(", ")
          : Number(bypass?.score || 0) > 0
            ? `${Number(bypass.score)} pont`
            : "nem"
      }`,
      `Válasz célpont: ${
        replyTarget?.targetTag ||
        (replyTarget?.targetId ? "ismeretlen tag" : "nincs")
      }`,
      `Staff felé ment: ${replyTarget?.targetIsStaff ? "igen" : "nem"}`,
      Array.isArray(final.behaviorLabels) && final.behaviorLabels.length
        ? `Viselkedési jel: ${final.behaviorLabels.slice(0, 3).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    700
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

async function resetAiRiskProfile(client, userId) {
  const oldProfile = getUserProfile(userId);
  const oldMessageId = store.caseMessages?.[userId] || null;

  if (oldMessageId) {
    try {
      const logChannel = await getLogChannel(client);
      if (logChannel) {
        const oldMsg = await logChannel.messages.fetch(oldMessageId).catch(() => null);
        if (oldMsg) {
          await oldMsg.delete().catch(() => null);
        }
      }
    } catch (error) {
      console.error("[AIMOD] régi case embed törlés hiba:", error);
    }
  }

  delete store.caseMessages[userId];

  store.users[userId] = {
    incidents: [],
    recentMessages: [],
    lastCaseAt: 0,
    watchUntil: 0,
    suspicion: 0,
    behaviorScore: 0,
    escalationLevel: 0,
    lastIncidentAt: 0,
    lastDecay: Date.now(),

    noticeState: {
      lastNoticeAt: 0,
      lastNoticeAction: "",
      lastNoticeMessageId: null,
    },

    rehab: {
      score: 0,
      goodDays: 0,
      level: "nincs",
      lastCheckAt: Date.now(),
      lastImprovedAt: 0,
    },

    activeCase: {
      lastAction: "AI kockázat törölve",
      lastActionRaw: "ignore",
      lastReason: "Staff kézzel lenullázta a kockázatot.",
      lastCategory: "Manuális törlés",
      lastSeverity: "enyhe",
      lastAnalysis:
        "A felhasználó AI moderációs előzményei és kockázati profilja kézzel lenullázásra kerültek.",
      lastPatternSummary: "A korábbi AI incidensek törölve lettek.",
      lastRuleBroken: "Kézi staff nullázás",
      lastMessageContent: "",
      lastMessageId: null,
      lastChannelId: null,
      lastProjectedRisk: 0,
      lastEvidence: "",
      lastModerationMode: "manual",
      lastShieldReason: "",
      lastBypassScore: 0,
      lastReplyTarget: "",
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

  saveStore();
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

await resetAiRiskProfile(client, member.id);

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
const newRisk = getRiskPercent(profile);
profile.behaviorScore = newRisk;
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

let caseLogSent = false;

try {
  const sentMsg = await resendUnifiedCaseMessage(client, member, profile);
  caseLogSent = Boolean(sentMsg);
} catch (error) {
  console.error("[AIMOD] mute összesítő log hiba:", error);
}

  await interaction.editReply({
    content:
      `✅ ${member.user.tag} némítva lett **${minutes}** percre.\n` +
      `📄 Eredeti indok: ${originalReason}\n` +
      `🤖 AI indok: ${aiReason}\n` +
      `📈 Hozzáadott pont: **${manualPoints}**\n` +
      `📊 Új risk:\n${formatRiskBlock(profile)}\n` +
      `📝 Mod log összesítő: ${caseLogSent ? "✅ elküldve" : "❌ nem sikerült elküldeni"}\n` +
      `✉️ DM állapot: ${dmSent ? "✅ elküldve" : "⚠️ nem sikerült elküldeni"}`,
      
  });
}
async function handleInteraction(client, interaction) { // idáig!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
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
async function refreshDecayedCaseEmbeds(client) {
  const logChannel = await getLogChannel(client);
  if (!logChannel) return;

  let changedAnything = false;

  for (const [userId, messageId] of Object.entries(store.caseMessages || {})) {
    if (!messageId) continue;

    const profile = store.users?.[userId];
    if (!profile) continue;

    const oldRisk = Number(profile.behaviorScore || 0);
    const newRisk = getRiskPercent(profile);

    let dirty = false;

    if (oldRisk !== newRisk) {
      profile.behaviorScore = newRisk;
      dirty = true;
    }

    if (Number(profile.activeCase?.lastProjectedRisk || 0) !== newRisk) {
      profile.activeCase = {
        ...(profile.activeCase || {}),
        lastProjectedRisk: newRisk,
        lastUpdatedAt: Date.now(),
      };
      dirty = true;
    }

    if (
      profile.activeCase?.lastActionRaw === "watch" &&
      !isWatchActive(profile) &&
      /watch/i.test(String(profile.activeCase?.currentStatus || ""))
    ) {
      profile.activeCase = {
        ...(profile.activeCase || {}),
        currentStatus: "Megfigyelés",
        lastUpdatedAt: Date.now(),
      };
      dirty = true;
    }

    if (!dirty) continue;

    const member =
      logChannel.guild.members.cache.get(userId) ||
      (await logChannel.guild.members.fetch(userId).catch(() => null)) ||
      {
        id: userId,
        user: {
          tag: "Ismeretlen",
          username: "Ismeretlen",
        },
      };

    const caseMessage = await logChannel.messages.fetch(messageId).catch(() => null);
    if (!caseMessage) continue;

    const embed = buildUnifiedEmbed({ member, profile });
    const components = buildButtons(userId, profile.activeCase?.lastActionRaw || "");

    await caseMessage.edit({
      embeds: [embed],
      components,
    }).catch(() => null);

    changedAnything = true;
  }

  if (changedAnything) {
    saveStore();
  }
}
function registerAiModeration(client) {
  client.once("ready", () => {
    setInterval(() => {
      refreshDecayedCaseEmbeds(client).catch((error) => {
        console.error("[AIMOD] decay embed refresh hiba:", error);
      });
    }, 10 * 60 * 1000);
  });

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
  applyManualModerationAndLog,
  formatDuration,
};