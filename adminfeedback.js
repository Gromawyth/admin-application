const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

// 🔧 ÁLLÍTSD BE
const LOG_CHANNEL_ID = "1485371309784563933";

// 👮 ADMINOK
const admins = [
  {
    id: "1",
    name: "Teszt1",
    level: "Főadmin",
    desc: "Bemutatkozas"
  },
  {
    id: "2",
    name: "Teszt2",
    level: "Admin 2",
    desc: "Bemutatkozas"
  },
  {
    id: "3",
    name: "Teszt3",
    level: "Adminsegéd",
    desc: "Bemutatkozas"
  }
];

// 📊 MEMÓRIA
let data = {};

// =========================
// SEGÉD
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
  return admin ? admin.name : adminId;
}

// =========================
// PANEL
// =========================

async function sendPanel(interaction) {
  for (const admin of admins) {
    const stats = getData(admin.id);

    const embed = new EmbedBuilder()
      .setTitle(`👮 ${admin.name}`)
      .setDescription(
        `**Szint:** ${admin.level}\n\n${admin.desc}\n\n⚠️ **Szabály:** Egy játékos havonta max **3 értékelést** adhat erre az adminra.`
      )
      .addFields({
        name: "📊 Értékelések",
        value: `👍 ${stats.pos} | 👎 ${stats.neg}`,
        inline: true
      })
      .setColor(0x5865F2)
      .setFooter({ text: `Admin ID: ${admin.id}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`feedback_pos_${admin.id}`)
        .setLabel("Pozitív")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`feedback_neg_${admin.id}`)
        .setLabel("Negatív")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });
  }

  await interaction.reply({
    content: "✅ Panelek kiküldve.",
    ephemeral: true
  });
}

// =========================
// GOMB
// =========================

async function handleButton(interaction) {
  if (!interaction.customId.startsWith("feedback_")) return;

  const [_, type, adminId] = interaction.customId.split("_");

  const modal = new ModalBuilder()
    .setCustomId(`feedback_modal_${type}_${adminId}`)
    .setTitle(type === "pos" ? "Pozitív értékelés" : "Negatív értékelés");

  const input = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Indoklás")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

// =========================
// MODAL
// =========================

async function handleModal(interaction) {
  if (!interaction.customId.startsWith("feedback_modal_")) return;

  const [_, __, type, adminId] = interaction.customId.split("_");
  const reason = interaction.fields.getTextInputValue("reason");

  const stats = getData(adminId);
  const month = getMonthKey();
  const userId = interaction.user.id;

  if (!stats.userMonthly[month]) stats.userMonthly[month] = {};
  if (!stats.userMonthly[month][userId]) stats.userMonthly[month][userId] = 0;

  // ❌ HAVI LIMIT
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

  // ✅ növelés
  if (type === "pos") stats.pos++;
  else stats.neg++;

  stats.userMonthly[month][userId]++;

  stats.reviews.push({
    user: userId,
    type,
    reason,
    month
  });

  const totalSoFar = getUserTotalRatings(userId);

  // 📤 LOG
  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

  if (logChannel) {
    const embed = new EmbedBuilder()
      .setTitle("📊 Új értékelés")
      .addFields(
        { name: "Admin", value: `${getAdminName(adminId)}\n\`${adminId}\`` },
        { name: "Felhasználó", value: `<@${userId}>` },
        { name: "Típus", value: type === "pos" ? "Pozitív" : "Negatív" },
        { name: "Indoklás", value: reason },
        {
          name: "Havi limit állás ennél az adminnál",
          value: `${stats.userMonthly[month][userId]}/3`,
          inline: true
        },
        {
          name: "Felhasználó összes értékelése",
          value: `${totalSoFar}`,
          inline: true
        }
      )
      .setColor(type === "pos" ? 0x2ecc71 : 0xe74c3c);

    await logChannel.send({ embeds: [embed] });
  }

  await interaction.reply({
    content:
      `✅ Értékelés elküldve.\n` +
      `📌 Ennél az adminnál ebben a hónapban: **${stats.userMonthly[month][userId]}/3**\n` +
      `📌 Eddigi összes leadott értékelésed: **${totalSoFar}**`,
    ephemeral: true
  });
}

// =========================
// RESET
// =========================

async function resetData(interaction) {
  data = {};

  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

  if (logChannel) {
    await logChannel.bulkDelete(100).catch(() => {});
  }

  await interaction.reply({
    content: "🔄 Minden értékelés és log törölve.",
    ephemeral: true
  });
}

module.exports = {
  sendPanel,
  resetData,
  handleButton,
  handleModal
};