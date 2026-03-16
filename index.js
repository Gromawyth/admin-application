require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
} = require("discord.js");

const app = express();

app.use(cors({
  origin: [
    "https://gromawyth.github.io",
    "http://127.0.0.1:5500",
    "http://localhost:5500"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.options("*", cors());
app.use(express.json());

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function safeValue(value) {
  if (value === null || value === undefined) return "Nincs megadva";
  const text = String(value).trim();
  return text.length ? text : "Nincs megadva";
}

function limitField(value, max = 1024) {
  const text = safeValue(value);
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function buildActionRow(applicationType, disabled = false) {
  const suffix = applicationType === "adminseged" ? "adminseged" : "admin";

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`accept_${suffix}`)
      .setLabel("Elfogadás")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`reject_${suffix}`)
      .setLabel("Elutasítás")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildAdminEmbeds(data) {
  const discordUserId = safeValue(data.discordNev);

  return [
    new EmbedBuilder()
      .setTitle("🟢 Új Adminisztrátori jelentkezés")
      .setDescription("━━━━━━━━━━ **01. ALAPADATOK** ━━━━━━━━━━")
      .setColor(0x1f8b4c)
      .addFields(
        { name: "📌 Jelentkezés típusa", value: "Adminisztrátor", inline: true },
        { name: "👤 Mi a karaktered neve?", value: limitField(data.karakterNev), inline: false },
        { name: "🆔 Discord User ID", value: limitField(discordUserId), inline: false },
        { name: "🎂 Hány éves vagy?", value: limitField(data.eletkor), inline: false },
        { name: "⏱️ Mennyi ideje játszol az internalGamingen?", value: limitField(data.jatszottIdo), inline: false },
        { name: "📅 Honnan találtál rá a szerverre?", value: limitField(data.internalTalalat), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **02. IDŐBEOSZTÁS** ━━━━━━━━━━")
      .setColor(0x239b56)
      .addFields(
        { name: "🕒 Mikor szoktál általában fent lenni hétköznap?", value: limitField(data.hetkoznapAktivitas), inline: false },
        { name: "🕒 Mikor szoktál általában fent lenni hétvégén?", value: limitField(data.hetvegeAktivitas), inline: false },
        { name: "⏱️ Heti hány órát tudsz aktívan játszani?", value: limitField(data.hetiOra), inline: false },
        { name: "🛠️ Mennyi időt tudnál az Admin Staff feladataira szánni?", value: limitField(data.staffIdo), inline: false },
        { name: "🔄 Változik ez az időbeosztásod gyakran?", value: limitField(data.idobeosztasValtozas), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **03. MOTIVÁCIÓ** ━━━━━━━━━━")
      .setColor(0x27ae60)
      .addFields(
        { name: "💭 Miért szeretnél az Admin Staff tagja lenni?", value: limitField(data.motivacio), inline: false },
        { name: "⭐ Mi az, ami megfogott az internalGamingben?", value: limitField(data.miFogottMeg), inline: false },
        { name: "🛠️ Mit gondolsz, miben tudnál segíteni a szervernek?", value: limitField(data.segiteni), inline: false },
        { name: "🔧 Van olyan dolog, amit változtatnál, ha lehetne?", value: limitField(data.valtoztatna), inline: false },
        { name: "👮 Mi a véleményed a jelenlegi Admin Staffról?", value: limitField(data.staffVelemeny), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **04. TAPASZTALAT** ━━━━━━━━━━")
      .setColor(0x2ecc71)
      .addFields(
        { name: "🛡️ Voltál-e már admin vagy adminsegéd más szerveren?", value: limitField(data.voltAdmin), inline: false },
        { name: "📍 Ha igen, hol és mennyi ideig?", value: limitField(data.holAdmin), inline: false },
        { name: "❓ Miért hagytad ott, vagy miért maradtál?", value: limitField(data.miertHagytad), inline: false },
        { name: "🧠 Van olyan életbeli tapasztalatod, ami hasznos lehet itt?", value: limitField(data.eletTapasztalat), inline: false },
        { name: "🔥 Hogyan kezeled a stresszt és a nyomást?", value: limitField(data.stressz), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **05. SZITUÁCIÓK** ━━━━━━━━━━")
      .setColor(0x58d68d)
      .addFields(
        { name: "🎮 Mit tennél, ha látnád, hogy valaki metagamingel?", value: limitField(data.metagaming), inline: false },
        { name: "⚖️ Hogyan kezelnéd, ha két játékos összekülönbözne OOC-ben?", value: limitField(data.oocVita), inline: false },
        { name: "🚨 Egy új játékos folyton megszegi a szabályokat. Mi a teendő?", value: limitField(data.szabalySzeges), inline: false },
        { name: "👥 Ha egy barátod szabálytalankodna, ugyanúgy kezelnéd?", value: limitField(data.baratSzabaly), inline: false },
        { name: "📣 Valaki szerint tévedtél egy döntésben. Hogyan reagálnál?", value: limitField(data.tevdes), inline: false },
        { name: "👮 Látod, hogy egy másik staff tag hibázik. Szólnál?", value: limitField(data.staffHiba), inline: false },
        { name: "😡 Egy játékos provokál és személyeskedik veled. Mit teszel?", value: limitField(data.provokal), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **06. RÓLAD MÉLYEBBEN** ━━━━━━━━━━")
      .setColor(0x82e0aa)
      .addFields(
        { name: "⚔️ Milyen vagy konfliktushelyzetben?", value: limitField(data.konfliktus), inline: false },
        { name: "📢 Tudsz-e kritikát elfogadni?", value: limitField(data.kritika), inline: false },
        { name: "🤝 Mi az, amiben biztosan számíthatnak rád?", value: limitField(data.mibenSzamithatunk), inline: false },
        { name: "🚫 Mi az, amit nem tudsz vállalni?", value: limitField(data.nemVallal), inline: false },
        { name: "👁️ Milyen staff tag szeretnél lenni - aktív, látható vagy inkább háttérben dolgozó?", value: limitField(data.staffTipus), inline: false },
        { name: "😤 Mi az, ami ki tud hozni a sodrodból?", value: limitField(data.sodor), inline: false },
        { name: "🎮 Hogyan reagálsz, ha unatkozol a játéktól?", value: limitField(data.unatkozik), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **07. EGYÉB** ━━━━━━━━━━")
      .setColor(0xa9dfbf)
      .addFields(
        { name: "💬 Van-e olyan, amit még el szeretnél mondani?", value: limitField(data.egyeb), inline: false },
        { name: "❓ Kérdeznél bármit a vezetőségtől?", value: limitField(data.kerdes), inline: false },
        { name: "🧑‍🏫 Mennyire vagy türelmes az új játékosokkal?", value: limitField(data.turelmes), inline: false },
        { name: "⚖️ Szoktál-e figyelmeztetés előtt büntetni, vagy szigorú vagy?", value: limitField(data.buntetes), inline: false },
        { name: "📜 Mi a véleményed a jelenlegi szabályzatról?", value: limitField(data.szabalyzat), inline: false }
      )
      .setFooter({ text: "Admin jelentkezési rendszer" })
      .setTimestamp()
  ];
}

function buildAdminSegedEmbeds(data) {
  const discordUserId = safeValue(data.discordID);

  return [
    new EmbedBuilder()
      .setTitle("🟢 Új Adminsegéd jelentkezés")
      .setDescription("━━━━━━━━━━ **I. ÁLTALÁNOS KÉRDÉSEK** ━━━━━━━━━━")
      .setColor(0x2ecc71)
      .addFields(
        { name: "📌 Jelentkezés típusa", value: "Adminsegéd", inline: true },
        { name: "🆔 Discord User ID", value: limitField(discordUserId), inline: false },
        { name: "🎂 Életkorod", value: limitField(data.eletkor), inline: false },
        { name: "⏱ Heti szinten mennyi időt tudnál az adminsegéd feladatokra fordítani?", value: limitField(data.hetiIdo), inline: false },
        { name: "👤 Önmagad rövid bemutatása", value: limitField(data.bemutatkozas), inline: false },
        { name: "🛡 Voltál-e már adminisztrátor vagy adminsegéd tag más szerveren? Ha igen, hol és milyen pozícióban?", value: limitField(data.voltStaff), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **II. SZITUÁCIÓS FELADATOK** ━━━━━━━━━━")
      .setColor(0x27ae60)
      .addFields(
        { name: "⚠ Egy játékos bizonyíthatóan visszaél egy rendszerhibával (bug), de népszerű tag. Hogyan jársz el?", value: limitField(data.bugVisszaeles), inline: false },
        { name: "🚗 Elkapsz egy ütközést. Annyi RP-t látsz, hogy /do megrázkódik vagy /do kocc. Mi itt a probléma? Hogyan jársz el? Ha szankcionálsz, miként teszed azt?", value: limitField(data.utkozesHelyzet), inline: false },
        { name: "👮 A rendvédelem valamely tagja jelez feléd, hogy direkt provokálják őket. Mit teszel?", value: limitField(data.rendvedelemProvokacio), inline: false },
        { name: "🆕 Egy új játékos sok kérdést tesz fel, de a válaszaid lassan érkeznek, ami frusztrálja őt. Hogyan reagálsz?", value: limitField(data.ujJatekosKezeles), inline: false }
      ),

    new EmbedBuilder()
      .setDescription("━━━━━━━━━━ **III. KOMPETENCIA ÉS HOZZÁÁLLÁS** ━━━━━━━━━━")
      .setColor(0x1f8b4c)
      .addFields(
        { name: "⚖ Mit jelent számodra a pártatlan eljárás egy adminügy kapcsán?", value: limitField(data.partatlansag), inline: false },
        { name: "⭐ Szerinted jó adminisztrátor válna belőled? Indokold!", value: limitField(data.joAdminLennek), inline: false },
        { name: "🔄 Te miként definiálnád a rugalmasság fogalmát?", value: limitField(data.rugalmassag), inline: false }
      )
      .setFooter({ text: "Adminsegéd jelentkezési rendszer" })
      .setTimestamp()
  ];
}

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

app.get("/", (req, res) => {
  res.status(200).json({ success: true, message: "API működik" });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    botReady: client.isReady(),
    hasAdminChannelId: !!process.env.ADMIN_CHANNEL_ID,
    hasAdminSegedChannelId: !!process.env.ADMINSEGED_CHANNEL_ID,
    hasStaffRoleId: !!process.env.STAFF_ROLE_ID
  });
});

app.get("/application", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Ez az endpoint él. Jelentkezést POST kéréssel kell küldeni."
  });
});

app.post("/application", async (req, res) => {
  try {
    if (!client.isReady()) {
      return res.status(503).json({
        success: false,
        error: "Bot még nem áll készen."
      });
    }

    const data = req.body || {};
    const applicationType = data.applicationType === "adminseged" ? "adminseged" : "adminisztrator";

    console.log("📥 Jelentkezés érkezett:", applicationType, Object.keys(data));

    const channelId =
      applicationType === "adminseged"
        ? process.env.ADMINSEGED_CHANNEL_ID
        : process.env.ADMIN_CHANNEL_ID;

    if (!channelId) {
      return res.status(500).json({
        success: false,
        error: "Hiányzik a megfelelő csatornaazonosító az ENV-ből."
      });
    }

    const channel = await client.channels.fetch(channelId).catch((err) => {
      console.error("❌ Channel fetch hiba:", err);
      return null;
    });

    if (!channel) {
      return res.status(404).json({
        success: false,
        error: "Nem találom a célcsatornát."
      });
    }

    if (typeof channel.send !== "function") {
      return res.status(400).json({
        success: false,
        error: "A megadott csatorna nem szöveges csatorna."
      });
    }

    const embeds =
      applicationType === "adminseged"
        ? buildAdminSegedEmbeds(data)
        : buildAdminEmbeds(data);

    const row = buildActionRow(applicationType, false);

    const message = await channel.send({
      content:
        applicationType === "adminseged"
          ? "🟢 **Új adminsegéd jelentkezés érkezett!**"
          : "📩 **Új admin jelentkezés érkezett!**",
      embeds,
      components: [row],
    });

    console.log("✅ Jelentkezés elküldve Discordra:", message.id);

    return res.status(200).json({
      success: true,
      messageId: message.id,
    });
  } catch (error) {
    console.error("❌ Hiba az /application végponton:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Belső szerverhiba."
    });
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isButton()) return;

    const member = interaction.member;

    if (!member || !member.roles?.cache?.has(process.env.STAFF_ROLE_ID)) {
      await interaction.reply({
        content: "Nincs jogosultságod a lap elbírálására.",
        ephemeral: true,
      });
      return;
    }

    const isAdminSeged = interaction.customId === "accept_adminseged" || interaction.customId === "reject_adminseged";
    const isAdmin = interaction.customId === "accept_admin" || interaction.customId === "reject_admin";

    if (!isAdminSeged && !isAdmin) {
      await interaction.reply({
        content: "Ismeretlen gomb.",
        ephemeral: true,
      });
      return;
    }

    const accepted = interaction.customId.startsWith("accept_");
    const applicationType = isAdminSeged ? "adminseged" : "adminisztrator";

    const originalEmbeds = interaction.message.embeds || [];
    const firstEmbed = originalEmbeds[0];

    if (!firstEmbed) {
      await interaction.reply({
        content: "Nem találom az eredeti embedet.",
        ephemeral: true,
      });
      return;
    }

    const applicantField = firstEmbed.fields?.find(
      (field) => field.name === "🆔 Discord User ID"
    );

    const discordUserId = applicantField?.value?.trim();

    const dmText = accepted
      ? applicationType === "adminseged"
        ? "Szia! Örömmel értesítünk, hogy az adminsegéd jelentkezésed **elfogadásra került**. Kérlek keresd fel a vezetőséget privát üzenetben a további részletekért."
        : "Szia! Örömmel értesítünk, hogy az admin jelentkezésed **elfogadásra került**. Kérlek keresd fel a vezető adminisztrátort privát üzenetben."
      : applicationType === "adminseged"
        ? "Szia! Értesítünk, hogy az adminsegéd jelentkezésed **elutasításra került**. Köszönjük a jelentkezésedet és az idődet."
        : "Szia! Értesítünk, hogy az admin jelentkezésed **elutasításra került**. Köszönjük a jelentkezésedet és az idődet.";

    const reviewEmbed = new EmbedBuilder()
      .setTitle(
        applicationType === "adminseged"
          ? "📋 Adminsegéd jelentkezés elbírálva"
          : "📋 Admin jelentkezés elbírálva"
      )
      .setColor(accepted ? 0x2ecc71 : 0xe74c3c)
      .addFields(
        {
          name: "Eredmény",
          value: accepted ? "✅ **ELFOGADVA**" : "❌ **ELUTASÍTVA**",
          inline: true
        },
        {
          name: "Elbírálta",
          value: `<@${interaction.user.id}>`,
          inline: true
        },
        {
          name: "Jelentkezés típusa",
          value: applicationType === "adminseged" ? "Adminsegéd" : "Adminisztrátor",
          inline: true
        }
      )
      .setTimestamp();

    const disabledRow = buildActionRow(applicationType, true);

    await interaction.update({
      embeds: [...originalEmbeds, reviewEmbed],
      components: [disabledRow],
    });

    if (discordUserId && /^\d+$/.test(discordUserId)) {
      try {
        const user = await client.users.fetch(discordUserId);

        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                applicationType === "adminseged"
                  ? "📨 Adminsegéd jelentkezés elbírálása"
                  : "📨 Admin jelentkezés elbírálása"
              )
              .setColor(accepted ? 0x2ecc71 : 0xe74c3c)
              .setDescription(dmText)
              .addFields(
                {
                  name: "Szerver",
                  value: safeValue(interaction.guild?.name || "internalGaming"),
                  inline: true,
                },
                {
                  name: "Elbírálta",
                  value: safeValue(interaction.user.tag),
                  inline: true,
                }
              )
              .setTimestamp()
          ],
        });
      } catch (dmError) {
        console.error("⚠️ Nem sikerült DM-et küldeni:", dmError.message);
      }
    } else {
      console.log("⚠️ Érvénytelen vagy hiányzó Discord User ID, DM kihagyva.");
    }
  } catch (error) {
    console.error("❌ Hiba interactionCreate közben:", error);

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: "Hiba történt a gomb feldolgozása közben.",
          ephemeral: true,
        });
      } catch {}
    }
  }
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP szerver fut a ${PORT} porton`);
});

console.log("DISCORD_TOKEN megvan:", !!process.env.DISCORD_TOKEN);
console.log("DISCORD_TOKEN hossza:", process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.length : 0);
console.log("DISCORD_TOKEN eleje:", process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.slice(0, 10) : "nincs");

client.login(process.env.DISCORD_TOKEN);