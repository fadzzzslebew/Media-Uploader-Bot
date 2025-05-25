'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import pino from 'pino';
import config from "./settings.js";
import handleMedia from "./handler/media.js";
import fs from 'fs';
import path from 'path';
import readline from 'node:readline'
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
import { dirname } from 'path';
const __dirname = dirname(__filename);

import { makeWASocket, DisconnectReason, useMultiFileAuthState, isJidGroup, Browsers, fetchLatestBaileysVersion } from 'naruyaizumi';
import { Boom } from '@hapi/boom';
import chalk from 'chalk'; 
import cfonts from 'cfonts'; 
import moment from 'moment-timezone'; 
import os from 'os'; 
import NodeCache from 'node-cache';

const logFilePath = path.join(__dirname, 'bot.log');
const sessionPath = path.join(__dirname, 'sessions'); 

const log = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  fs.appendFileSync(logFilePath, logMessage);
};

const port = process.env.PORT || 8080;

const app = express();
const bot = new TelegramBot(config.botToken, { polling: true });


global.settings = { self: false };
try {
  global.settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf-8'));
} catch (e) {
  console.warn(chalk.yellow("[!] settings.json not found or invalid. Using default self mode."));
}
global.selfMode = global.settings.self;
global.displayedBanner = false;

const formatUptime = (seconds) => {
  const days = Math.floor(seconds / (24 * 60 * 60));
  seconds -= days * 24 * 60 * 60;
  const hours = Math.floor(seconds / (60 * 60));
  seconds -= hours * 60 * 60;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  seconds = Math.floor(seconds);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
};

const displayBanner = () => {
  if (global.displayedBanner) return;
  global.displayedBanner = true;

  console.clear();
  cfonts.say('flowbot', {
    font: 'simple',
    align: 'left',
    colors: ['cyan', 'green'],
    background: 'transparent',
    letterSpacing: 0,
    lineHeight: 0,
    space: false,
    maxLength: 5,
    gradient: true,
    independentGradient: false,
    transitionGradient: false
  });

  const uptime = formatUptime(os.uptime());
  const currentTime = moment().tz("Asia/Jakarta").format("HH:mm:ss DD/MM/YYYY");
  const botMode = global.selfMode ? "Self Mode" : "Public Mode";
  const nodeVer = process.version;
  const memUsage = ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(0);

  console.log(chalk.yellow(`
# Time WIB: ${chalk.green(currentTime)}
# Platform: ${chalk.green(os.platform())} (${os.arch()})
# Memory: ${chalk.green(memUsage)}% used
# Uptime: ${chalk.green(uptime)}
# Node.js: ${chalk.green(nodeVer)}
# Mode: ${chalk.green(botMode)}
# Creator: ${chalk.green('FlowFalcon')}

`));
};

const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

const store = {
  groupMetadata: {},
  contacts: {},
  messages: {},
};


app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const data = {
    status: 'true',
    message: 'Bot Successfully Activated!',
    author: 'FlowFalcon'
  };
  const result = {
    response: data
  };
  res.send(JSON.stringify(result, null, 2));
  log('GET / - Bot Successfully Activated!');
  console.log('GET / - Bot Successfully Activated!');
});

function listenOnPort(port) {
  app.listen(port, () => {
    log(`Server is running on port ${port}`);
    console.log(`Server is running on port ${port}`);
  });

  app.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`Port ${port} is already in use. Trying another port...`);
      console.log(`Port ${port} is already in use. Trying another port...`);
      listenOnPort(port + 1);
    } else {
      log(`Server error: ${err.message}`);
      console.log(`Server error: ${err.message}`);
    }
  });
}

listenOnPort(port);

// --- Telegram Bot Handlers ---
bot.onText(/^\/start$/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, config.message.info);
  log(`Received /start command from chat ID: ${chatId}`);
  console.log(`Received /start command from chat ID: ${chatId}`);
});

bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private') return;

  if (
    msg.photo || msg.document || msg.video ||
    msg.audio || msg.voice || msg.caption
  ) {
    await handleMedia(bot, msg, 'telegram');
  }
});


bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('copy_')) {
    const urlToCopy = data.replace('copy_', '');
    bot.answerCallbackQuery(callbackQuery.id, { text: `URL copied: ${urlToCopy}` });
    log(`Callback query for copying URL: ${urlToCopy} from chat ID: ${chatId}`);
    console.log(`Callback query for copying URL: ${urlToCopy} from chat ID: ${chatId}`);
  }
});

// --- WhatsApp Bot Integration (Baileys) ---
async function connectToWhatsApp() {
    displayBanner();
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const cache = new NodeCache({ stdTTL: 5 * 60, useClones: false });

    let useQR = false;
    let usePairing = false;

    if (!fs.existsSync(path.join(sessionPath, "creds.json"))) {
        console.log(chalk.cyan("\n[?] Choose authentication method:"));
        console.log(chalk.yellow("[1] Pairing Code"));
        console.log(chalk.yellow("[2] QR Code"));

        const authChoice = await question(chalk.green("> Enter choice (1/2): "));
        useQR = authChoice === "2";
        usePairing = authChoice === "1" || !useQR;
    } else {     
        console.log(chalk.green("[+] Reconnecting with existing session..."));
    }

    const sock = makeWASocket({
      logger: pino({ level: "silent" }), 
      printQRInTerminal: useQR,
      version,
      auth: state,
      browser: Browsers.ubuntu("chrome"),
      syncFullHistory: true 
    });

    if (!sock.authState.creds.registered && !fs.existsSync(path.join(sessionPath, "creds.json"))) {
      if (usePairing) {
        console.log(chalk.cyan("\n[!] Input Your WhatsApp Number for Pairing:"));
        const phone_number = await question(chalk.green("> Your Number (with country code, no + or spaces): "));
        console.log(chalk.yellow(`Your Selected Number [ ${phone_number} ]`));

        try {
          const code = await sock.requestPairingCode(phone_number);
          console.log(chalk.green(`\n[✓] Your Pairing Code: ${chalk.bold.white(code?.match(/.{1,4}/g)?.join('-') || code)}`));
          console.log(chalk.cyan("[i] Enter this code in your WhatsApp app to connect.\n"));
        } catch (error) {
          console.log(chalk.red(`\n[✗] Error requesting pairing code: ${error.message}`));
          console.log(chalk.red("[!] Please restart the bot to try again or choose QR code."));
          process.exit(1);
        }
      } else {
        console.log(chalk.cyan("\n[!] Please scan the QR code to connect."));
      }
    }

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, isNewLogin, isOnline } = update;

      if (isNewLogin) {
        console.log(chalk.green("\n[+] First time connected with Device"));
      }

      if (isOnline) {
        console.log(chalk.green("[+] Bot is Online!"));
      }

      if (connection === "connecting") {
        console.log(chalk.yellow("[+] Connecting to WhatsApp..."));
      } else if (connection === "open") {
        console.log(chalk.green("[+] Successfully connected to WhatsApp"));
      } else if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(chalk.red(`\n[✗] Connection closed with status: ${statusCode}`));
        console.log(chalk.yellow("[+] Reconnecting to WhatsApp..."));
        global.displayedBanner = false; 
        setTimeout(async () => {
          await connectToWhatsApp(); 
        }, 3000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type === 'notify') {
        for (let chatUpdate of messages) {
          if (!chatUpdate.key.fromMe && chatUpdate.key.remoteJid !== 'status@broadcast') {
            const jid = chatUpdate.key.remoteJid;

            if (!jid.endsWith('@s.whatsapp.net')) {
              console.log(`⛔ Pesan dari id (${jid}) diabaikan`);
              continue;
             }

            if (chatUpdate.message) {
              const messageContent = chatUpdate.message;

              if (messageContent.buttonsResponseMessage) {
                  const buttonId = messageContent.buttonsResponseMessage.selectedButtonId;
                  if (buttonId.startsWith('copy_')) {
                      const urlToCopy = buttonId.replace('copy_', '');
                      await sock.sendMessage(jid, { text: `URL untuk disalin:\n\`\`\`\n${urlToCopy}\n\`\`\`\nSilakan salin secara manual.` });
                      log(`WhatsApp Button 'Salin' clicked for URL: ${urlToCopy} by JID: ${jid}`);
                      console.log(`WhatsApp Button 'Salin' clicked for URL: ${urlToCopy} by JID: ${jid}`);
                  } else if (buttonId.startsWith('open_')) {
                      const urlToOpen = buttonId.replace('open_', '');
                      await sock.sendMessage(jid, { text: `Membuka link: ${urlToOpen}\nAnda bisa mengklik link ini secara langsung.` });
                      log(`WhatsApp Button 'Buka Link' clicked for URL: ${urlToOpen} by JID: ${jid}`);
                      console.log(`WhatsApp Button 'Buka Link' clicked for URL: ${urlToOpen} by JID: ${jid}`);
                  }
                  continue;
              }
              if (messageContent.imageMessage || messageContent.documentMessage || messageContent.videoMessage || messageContent.audioMessage || messageContent.stickerMessage) {
                await handleMedia(sock, chatUpdate, 'whatsapp');
              }
              else if (messageContent.conversation || messageContent.extendedTextMessage) {
                const text = messageContent.conversation || messageContent.extendedTextMessage.text;
                if (text === '/start') {
                  await sock.sendMessage(jid, { text: config.message.info });
                  log(`Received /start command from WhatsApp JID: ${jid}`);
                  console.log(`Received /start command from WhatsApp JID: ${jid}`);
                } else {              
                  await handleMedia(sock, chatUpdate, 'whatsapp');
                }
              }
            }
          }
        }
      }
    });

    return sock;
  }
  connectToWhatsApp();