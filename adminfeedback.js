const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// =========================
// ⚙️ BEÁLLÍTÁSOK
// =========================

const LOG_CHANNEL_ID =
  process.env.ADMIN_FEEDBACK_LOG_CHANNEL_ID || "1485371309784563933";

const SUMMARY_CHANNEL_ID =
  process.env.ADMIN_FEEDBACK_SUMMARY_CHANNEL_ID || "1485392296714174544";

const DATA_FILE = path.join(__dirname, "adminfeedback-data.json");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =========================
// 👮 ADMINOK
// =========================

const admins = [
  {
    id: "1",
    name: "Gromawyth",
    level: "Lead Administrator",
    desc: `Sziasztok! Gromawyth vagyok.

A szerveren Lead Administrator szerepet töltök be, ahol a fő feladatom a közösség stabil működésének fenntartása és az adminsegéd csapat koordinálása.

Számomra kiemelten fontos a korrekt és átlátható döntéshozatal, ezért minden helyzetben igyekszem pártatlanul, higgadtan és a szabályoknak megfelelően eljárni. Konfliktusok esetén mindig meghallgatom az érintett feleket, és csak ezután hozok döntést.

Nagy hangsúlyt fektetek arra, hogy a szerver egy élvezhető és igazságos környezet maradjon minden játékos számára. Ha kérdésed van, vagy segítségre van szükséged, nyugodtan fordulj hozzám.`
  },
  {
    id: "2",
    name: "Gromawyth 2",
    level: "Admin 2",
    desc: "teszt"
  },
  {
    id: "3",
    name: "teszt3",
    level: "Adminsegéd",
    desc: "teszt432"
  }
];

// =========================
// 💾 JSON BETÖLTÉS / MENTÉS
// =========================

function getDefaultStore() {
  return {
    ratings: {},
    summaryMessages: {},
    panelMessages: {},
    rulesMessageId: null
  };
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return getDefaultStore();
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw.trim()) return getDefaultStore();

    const parsed = JSON.parse(raw);

    return {
      ratings: parsed.ratings || {},
      summaryMessages: parsed.summaryMessages || {},
      panelMessages: parsed.panelMessages || {},
      rulesMessageId: parsed.rulesMessageId || null
    };
  } catch (error) {
    console.error("❌ Hiba a JSON betöltésekor:", error);
    return getDefaultStore();
  }
}

let loadedData = loadData();
let data = loadedData.ratings;
let summaryMessages = loadedData.summaryMessages;
let panelMessages = loadedData.panelMessages;
let rulesMessageId = loadedData.rulesMessageId;

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          ratings: data,
          summaryMessages,
          panelMessages,
          rulesMessageId
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.error("❌ Hiba a JSON mentésekor:", error);
  }
}

// =========================
// 🧩 SEGÉDFÜGGVÉNYEK
// =========================

function getMonthKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getData(adminId) {
  if (!data[adminId]) {
    data[adminId] = {
      pos: 0,
      neg: 0,
      reviews: [],
      userMonthly: {}
    };
  }
  return data[adminId];
}

function getUserTotalRatings(userId) {
  let total = 0;

  for (const adminId of Object.keys(data)) {
    const adminData = data[adminId];
    if (!adminData?.reviews?.length) continue;

    for (const review of adminData.reviews) {
      if (review.user === userId) total++;
    }
  }

  return total;
}

function getAdminName(adminId) {
  const admin = admins.find(a => a.id === adminId);
  return admin ? admin.name : "Ismeretlen admin";
}

function trimText(text, max = 1024) {
  const value = String(text || "").trim() || "Nincs megadva";
  return value.length > max ? value.slice(0, max - 3) + "..." : value;
}

function trimField(text, max = 1024) {
  return trimText(text, max);
}

function getPercent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function getRatingBar(pos, neg) {
  const total = pos + neg;
  if (total === 0) return "░░░░░░░░░░";

  const positiveRatio = pos / total;
  const filled = Math.round(positiveRatio * 10);
  return "🟩".repeat(filled) + "🟥".repeat(10 - filled);
}

async function fetchGuildChannel(guild, channelId) {
  if (!guild || !channelId || channelId.startsWith("IDE_")) return null;

  return guild.channels.cache.get(channelId) ||
    await guild.channels.fetch(channelId).catch(() => null);
}

function getRecentReviews(adminId, limit = 20) {
  const stats = getData(adminId);
  return [...stats.reviews]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

function buildFallbackSummary(adminId) {
  const stats = getData(adminId);
  const total = stats.pos + stats.neg;

  if (total === 0 || !stats.reviews.length) {
    return "Nincs még beérkező válasz.";
  }

  const positives = stats.reviews.filter(r => r.type === "pos").length;
  const negatives = stats.reviews.filter(r => r.type === "neg").length;

  return (
    `Az adminról eddig ${total} értékelés érkezett, ebből ${positives} pozitív és ${negatives} negatív. ` +
    `Az összkép jelenleg ${positives >= negatives ? "inkább pozitív" : "inkább negatív"}, ` +
    `de a pontosabb megítéléshez további részletes visszajelzések is hasznosak lehetnek.`
  );
}

async function generateAiSummary(adminId) {
  const admin = admins.find(a => a.id === adminId);
  const stats = getData(adminId);

  if (!admin || !stats.reviews.length) {
    return "Nincs még beérkező válasz.";
  }

  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackSummary(adminId);
  }

  const recentReviews = getRecentReviews(adminId, 20);

  const reviewsText = recentReviews.map((review, index) => {
    const typeLabel = review.type === "pos" ? "Pozitív" : "Negatív";
    return [
      `${index + 1}. értékelés`,
      `Típus: ${typeLabel}`,
      `Szituáció: ${review.situation || "Nincs megadva"}`,
      `Indoklás: ${review.reason || "Nincs megadva"}`,
      `Erősségek / hibák: ${review.strengths || "Nincs megadva"}`,
      `Extra: ${review.extra || "Nincs megadva"}`
    ].join("\n");
  }).join("\n\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "Egy Discord admin értékelő rendszer elemzője vagy. Magyar nyelven írj. " +
            "Készíts legalább 10 mondatos, természetes hangzású, objektív összefoglalót a beérkező válaszok alapján. " +
            "Emeld ki a visszatérő pozitívumokat, negatívumokat, kommunikációt, segítőkészséget, gyorsaságot, igazságosságot, hozzáállást és a javítandó pontokat. " +
            "Ne listában írj, hanem összefüggő szövegben."
        },
        {
          role: "user",
          content:
            `Admin neve: ${admin.name}\n` +
            `Szint: ${admin.level}\n` +
            `Pozitív értékelések: ${stats.pos}\n` +
            `Negatív értékelések: ${stats.neg}\n\n` +
            `Beérkező válaszok:\n${reviewsText}`
        }
      ]
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    return content || buildFallbackSummary(adminId);
  } catch (error) {
    console.error("❌ AI összegzés hiba:", error);
    return buildFallbackSummary(adminId);
  }
}

// =========================
// 🎨 EMBED ÉPÍTŐK
// =========================

function buildRulesEmbed() {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("📜 Értékelési szabályzat")
    .setDescription("🧾 Kérünk, hogy minden véleményt kulturáltan, valós tapasztalat alapján írj meg.")
    .addFields(
      {
        name: "⚖️ Alapelvek",
        value:
          "• Egy játékos havonta legfeljebb **3 értékelést** adhat ugyanarra az adminra.\n" +
          "• Az értékelésnek valódi tapasztalaton kell alapulnia.\n" +
          "• Indoklás nélkül vagy troll célból ne küldj értékelést.",
        inline: false
      },
      {
        name: "🔍 Fontos tudnivalók",
        value:
          "• A válaszok a vezetőség számára láthatók.\n" +
          "• A visszaélések szankciót vonhatnak maguk után.\n" +
          "• Minden beküldés naplózásra kerül.",
        inline: false
      }
    )
    .setFooter({ text: "🙏 Köszönjük a kulturált és őszinte visszajelzéseket." });
}

function buildAdminPanelEmbed(admin, stats) {
  const total = stats.pos + stats.neg;
  const posPercent = getPercent(stats.pos, total);
  const negPercent = getPercent(stats.neg, total);
  const bar = getRatingBar(stats.pos, stats.neg);

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`⭐ ${admin.name}`)
    .setDescription(
      `🏷️ **Szint:** ${admin.level}\n\n💬 **Bemutatkozás:**\n${admin.desc}`
    )
    .addFields(
      {
        name: "📊 Értékelési összesítés",
        value:
          `🟢 Pozitív: **${stats.pos}** (${posPercent}%)\n` +
          `🔴 Negatív: **${stats.neg}** (${negPercent}%)\n` +
          `📦 Összes értékelés: **${total}**`,
        inline: true
      },
      {
        name: "📈 Visszajelzési arány",
        value: `${bar}`,
        inline: true
      }
    )
    .setFooter({ text: "👇 Válassz alul pozitív vagy negatív értékelést." });
}

function buildAdminButtons(adminId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`feedback_pos_${adminId}`)
      .setLabel("🟢 Pozitív értékelés")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`feedback_neg_${adminId}`)
      .setLabel("🔴 Negatív értékelés")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildSummaryEmbed(admin, stats, aiSummary) {
  const total = stats.pos + stats.neg;
  const posPercent = getPercent(stats.pos, total);
  const negPercent = getPercent(stats.neg, total);
  const bar = getRatingBar(stats.pos, stats.neg);

  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`📌 ${admin.name}`)
    .setDescription(
      `🏷️ **Szint:** ${admin.level}\n` +
      `🔄 **Állapot:** Folyamatosan frissülő összesítő`
    )
    .addFields(
      {
        name: "📊 Értékelési összesítés",
        value:
          `🟢 Pozitív: **${stats.pos}** (${posPercent}%)\n` +
          `🔴 Negatív: **${stats.neg}** (${negPercent}%)\n` +
          `📦 Összes: **${total}**`,
        inline: true
      },
      {
        name: "📈 Arány",
        value: `${bar}`,
        inline: true
      },
      {
        name: "🤖 AI leírás",
        value: trimField(aiSummary || "Nincs még beérkező válasz.", 1024),
        inline: false
      }
    )
    .setFooter({ text: "📘 Admin értékelési összesítő" })
    .setTimestamp();
}

function buildLogEmbed({
  type,
  adminName,
  userId,
  situation,
  reason,
  strengths,
  extra,
  userMonthlyCount,
  totalSoFar
}) {
  return new EmbedBuilder()
    .setColor(type === "pos" ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${type === "pos" ? "🟢 Pozitív" : "🔴 Negatív"} admin értékelés`)
    .setDescription(
      `👮 **Admin neve:** ${trimText(adminName)}\n` +
      `👤 **Beküldte:** <@${userId}>\n` +
      `🏷️ **Típus:** ${type === "pos" ? "Pozitív" : "Negatív"}`
    )
    .addFields(
      {
        name: "🧩 Milyen szituációban találkoztál vele?",
        value: trimText(situation),
        inline: false
      },
      {
        name: "💭 Miért értékeled így az admint?",
        value: trimText(reason),
        inline: false
      },
      {
        name: "⭐ Milyen erősségei vagy hibái voltak?",
        value: trimText(strengths),
        inline: false
      },
      {
        name: "📝 További megjegyzés",
        value: trimText(extra),
        inline: false
      },
      {
        name: "📊 Statisztika",
        value:
          `• Ennél az adminnál ebben a hónapban: **${userMonthlyCount}/3**\n` +
          `• Felhasználó összes értékelése: **${totalSoFar}**`,
        inline: false
      }
    )
    .setFooter({ text: "📚 Admin értékelési napló" })
    .setTimestamp();
}

// =========================
// 📌 ÖSSZESÍTŐ CSATORNA
// =========================

async function createOrUpdateSummary(guild, adminId) {
  const channel = await fetchGuildChannel(guild, SUMMARY_CHANNEL_ID);
  if (!channel) return;

  const admin = admins.find(a => a.id === adminId);
  if (!admin) return;

  const stats = getData(adminId);
  const aiSummary = await generateAiSummary(adminId);
  const embed = buildSummaryEmbed(admin, stats, aiSummary);

  if (!summaryMessages[adminId]) {
    const msg = await channel.send({ embeds: [embed] });
    summaryMessages[adminId] = msg.id;
    saveData();
    return;
  }

  try {
    const msg = await channel.messages.fetch(summaryMessages[adminId]);
    await msg.edit({ embeds: [embed] });
  } catch {
    const msg = await channel.send({ embeds: [embed] });
    summaryMessages[adminId] = msg.id;
    saveData();
  }
}

async function rebuildAllSummaries(guild) {
  for (const admin of admins) {
    await createOrUpdateSummary(guild, admin.id);
  }
}

// =========================
// 📤 PANEL KÜLDÉS
// =========================

async function sendPanel(interaction) {
  for (const admin of admins) {
    const stats = getData(admin.id);
    const embed = buildAdminPanelEmbed(admin, stats);
    const row = buildAdminButtons(admin.id);

    if (!panelMessages[admin.id]) {
      const msg = await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });
      panelMessages[admin.id] = msg.id;
      saveData();
    } else {
      try {
        const msg = await interaction.channel.messages.fetch(panelMessages[admin.id]);
        await msg.edit({
          embeds: [embed],
          components: [row]
        });
      } catch {
        const msg = await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });
        panelMessages[admin.id] = msg.id;
        saveData();
      }
    }

    await createOrUpdateSummary(interaction.guild, admin.id);
  }

  const rulesEmbed = buildRulesEmbed();

  if (!rulesMessageId) {
    const msg = await interaction.channel.send({
      embeds: [rulesEmbed]
    });
    rulesMessageId = msg.id;
    saveData();
  } else {
    try {
      const msg = await interaction.channel.messages.fetch(rulesMessageId);
      await msg.edit({ embeds: [rulesEmbed] });
    } catch {
      const msg = await interaction.channel.send({
        embeds: [rulesEmbed]
      });
      rulesMessageId = msg.id;
      saveData();
    }
  }

  await interaction.reply({
    content: "✅ Az admin értékelő panelek kiküldve és frissítve.",
    ephemeral: true
  });
}

// =========================
// 🔘 GOMBKEZELÉS
// =========================

async function handleButton(interaction) {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("feedback_")) return;

  const [, type, adminId] = interaction.customId.split("_");
  const adminName = getAdminName(adminId);

  const modal = new ModalBuilder()
    .setCustomId(`feedback_modal_${type}_${adminId}`)
    .setTitle(`${type === "pos" ? "🟢 Pozitív" : "🔴 Negatív"} értékelés`);

  const input1 = new TextInputBuilder()
    .setCustomId("situation")
    .setLabel("🧩 Milyen szituációban találkoztál vele?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder(`Írd le röviden, milyen helyzetben kerültél kapcsolatba vele (${adminName}).`);

  const input2 = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("💭 Miért értékeled így az admint?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder("Írd le röviden, mi alapján alakult ki a véleményed.");

  const input3 = new TextInputBuilder()
    .setCustomId("strengths")
    .setLabel("⭐ Milyen erősségei vagy hibái voltak?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder("Pl. gyors, türelmes, segítőkész / lassú, lekezelő, pontatlan.");

  const input4 = new TextInputBuilder()
    .setCustomId("extra")
    .setLabel("📝 Van még valami fontos, amit hozzátennél?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder("Ez a mező opcionális.");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input1),
    new ActionRowBuilder().addComponents(input2),
    new ActionRowBuilder().addComponents(input3),
    new ActionRowBuilder().addComponents(input4)
  );

  await interaction.showModal(modal);
}

// =========================
// 📩 MODAL KEZELÉS
// =========================

async function handleModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith("feedback_modal_")) return;

  const [, , type, adminId] = interaction.customId.split("_");

  const situation = interaction.fields.getTextInputValue("situation");
  const reason = interaction.fields.getTextInputValue("reason");
  const strengths = interaction.fields.getTextInputValue("strengths");

  let extra = "Nincs megadva";
  try {
    extra = interaction.fields.getTextInputValue("extra") || "Nincs megadva";
  } catch {
    extra = "Nincs megadva";
  }

  const stats = getData(adminId);
  const month = getMonthKey();
  const userId = interaction.user.id;

  if (!stats.userMonthly[month]) stats.userMonthly[month] = {};
  if (!stats.userMonthly[month][userId]) stats.userMonthly[month][userId] = 0;

  if (stats.userMonthly[month][userId] >= 3) {
    const totalSoFar = getUserTotalRatings(userId);

    await interaction.reply({
      content:
        `❌ Ebben a hónapban már elérted a 3 értékelést erre az adminra.\n` +
        `📌 Eddigi összes leadott értékelésed: **${totalSoFar}**`,
      ephemeral: true
    });
    return;
  }

  if (type === "pos") stats.pos++;
  else stats.neg++;

  stats.userMonthly[month][userId]++;
  stats.reviews.push({
    user: userId,
    type,
    month,
    situation,
    reason,
    strengths,
    extra,
    createdAt: new Date().toISOString()
  });

  saveData();

  const totalSoFar = getUserTotalRatings(userId);
  const adminName = getAdminName(adminId);

  const logChannel = await fetchGuildChannel(interaction.guild, LOG_CHANNEL_ID);

  if (logChannel) {
    const logEmbed = buildLogEmbed({
      type,
      adminName,
      userId,
      situation,
      reason,
      strengths,
      extra,
      userMonthlyCount: stats.userMonthly[month][userId],
      totalSoFar
    });

    await logChannel.send({ embeds: [logEmbed] });
  }

  await createOrUpdateSummary(interaction.guild, adminId);
  await refreshPublicPanel(interaction.guild, adminId);

  await interaction.reply({
    content:
      `✅ Értékelés elküldve.\n` +
      `📌 Ennél az adminnál ebben a hónapban: **${stats.userMonthly[month][userId]}/3**\n` +
      `📌 Eddigi összes leadott értékelésed: **${totalSoFar}**`,
    ephemeral: true
  });
}

// =========================
// 🌐 PUBLIKUS PANEL FRISSÍTÉS
// =========================

async function refreshPublicPanel(guild, adminId) {
  const msgId = panelMessages[adminId];
  if (!msgId) return;

  const admin = admins.find(a => a.id === adminId);
  if (!admin) return;

  for (const channel of guild.channels.cache.values()) {
    if (!channel || typeof channel.messages?.fetch !== "function") continue;

    try {
      const msg = await channel.messages.fetch(msgId).catch(() => null);
      if (!msg) continue;

      const stats = getData(adminId);
      await msg.edit({
        embeds: [buildAdminPanelEmbed(admin, stats)],
        components: [buildAdminButtons(admin.id)]
      });
      return;
    } catch {}
  }
}

// =========================
// 🔄 RESET
// =========================

async function resetData(interaction) {
  data = {};
  saveData();

  await rebuildAllSummaries(interaction.guild);

  for (const admin of admins) {
    await refreshPublicPanel(interaction.guild, admin.id);
  }

  const logChannel = await fetchGuildChannel(interaction.guild, LOG_CHANNEL_ID);

  if (logChannel) {
    await logChannel.bulkDelete(100).catch(() => {});
  }

  await interaction.reply({
    content: "🔄 Minden értékelés nullázva, az összesítő és a publikus panelek frissítve.",
    ephemeral: true
  });
}

module.exports = {
  sendPanel,
  resetData,
  handleButton,
  handleModal,
  rebuildAllSummaries,
  refreshPublicPanel
}