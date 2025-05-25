import uploadFile from 'cloudku-uploader';
import { fileTypeFromBuffer } from 'file-type';
import axios from 'axios';
import config from "../settings.js";
import { Buffer } from 'buffer';
import { downloadMediaMessage } from 'naruyaizumi';

const handleMedia = async (bot, msg, platform) => {
  let chatId, fileId, fileName, buffer;

  try {
    if (platform === 'telegram') {
      chatId = msg.chat.id;

      if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
      } else if (msg.document) {
        fileId = msg.document.file_id;
        fileName = msg.document.file_name;
      } else if (msg.video) {
        fileId = msg.video.file_id;
        fileName = msg.video.file_name || "video.mp4";
      } else if (msg.audio) {
        fileId = msg.audio.file_id;
        fileName = msg.audio.file_name || "audio.mp3";
      } else if (msg.voice) {
        fileId = msg.voice.file_id;
        fileName = "voice.ogg";
      } else if (msg.text) {
        return;
      }

      if (!buffer && fileId) {
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
        const res = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        buffer = Buffer.from(res.data, 'binary');

        if (!fileName) {
          const type = await fileTypeFromBuffer(buffer);
          fileName = `upload.${type?.ext || 'bin'}`;
        }
      }

    } else if (platform === 'whatsapp') {
      chatId = msg.key.remoteJid;

      const messageContent = msg.message;
      if (messageContent.imageMessage) {
        buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: bot.updateMediaMessage });
        fileName = messageContent.imageMessage.fileName || `image.${(await fileTypeFromBuffer(buffer)).ext}`;
      } else if (messageContent.documentMessage) {
        buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: bot.updateMediaMessage });
        fileName = messageContent.documentMessage.fileName;
      } else if (messageContent.videoMessage) {
        buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: bot.updateMediaMessage });
        fileName = messageContent.videoMessage.fileName || `video.${(await fileTypeFromBuffer(buffer)).ext}`;
      } else if (messageContent.audioMessage) {
        buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: bot.updateMediaMessage });
        fileName = messageContent.audioMessage.fileName || `audio.${(await fileTypeFromBuffer(buffer)).ext}`;
      } else if (messageContent.stickerMessage) {
        buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: bot.updateMediaMessage });
        fileName = `sticker.${(await fileTypeFromBuffer(buffer)).ext}`;
      } else if (messageContent.conversation || messageContent.extendedTextMessage) {
        const text = messageContent.conversation || messageContent.extendedTextMessage.text;
         if (text?.startsWith('/start')) {
         await bot.sendMessage(chatId, { text: config.message.info });
  }
  return;
}


      if (!buffer) {
        await bot.sendMessage(chatId, { text: "❌ Gagal mengambil media WhatsApp." });
        return;
      }
    }

    if (!buffer || !fileName) {
      if (platform === 'telegram') {
        await bot.sendMessage(chatId, "❌ Gagal mengambil media.");
      } else if (platform === 'whatsapp') {
        await bot.sendMessage(chatId, { text: "❌ Gagal mengambil media." });
      }
      return;
    }

    const spinnerFrames = ['⠋', '⠙', '⠸', '⠴', '⠦', '⠇'];
    let spinnerMsgTelegram;

    if (platform === 'telegram') {
      spinnerMsgTelegram = await bot.sendMessage(chatId, `${spinnerFrames[0]} *Menghubungkan ke CloudKu...*`, {
        parse_mode: 'Markdown'
      });
    } else if (platform === 'whatsapp') {
      await bot.sendMessage(chatId, { text: `${spinnerFrames[0]} *Menghubungkan ke CloudKu...*` });
    }

    for (let i = 1; i < spinnerFrames.length; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (platform === 'telegram') {
        await bot.editMessageText(`${spinnerFrames[i]} *Menghubungkan ke CloudKu...*`, {
          chat_id: chatId,
          message_id: spinnerMsgTelegram.message_id,
          parse_mode: 'Markdown'
        });
      } else if (platform === 'whatsapp') {
      }
    }

    const result = await uploadFile(buffer, fileName);
    if (!result?.status) throw new Error("Gagal upload.");

    const { filename, type, size, url } = result.result;

    const caption = `✅ *Upload Sukses!*\n\n` +
      `📂 *File:* ${filename}\n` +
      `📛 *Tipe:* ${type}\n` +
      `📊 *Ukuran:* ${size}\n` +
      `🔗 *URL:* ${url}\n`;

    if (platform === 'telegram') {
      await bot.editMessageText(caption, {
        chat_id: chatId,
        message_id: spinnerMsgTelegram.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Buka Link', url }],
            [{ text: 'Salin', callback_data: `copy_${url}` }]
          ]
        }
      });
    } else if (platform === 'whatsapp') {
        await bot.sendMessage(
            chatId,
            {
                text: caption,
                footer: 'Powered by CloudKu & UploaderBot',
                interactiveButtons: [
                    {
                        name: 'cta_url', 
                        buttonParamsJson: JSON.stringify({
                            display_text: 'Buka Link',
                            url: url,
                            merchant_url: url
                        })
                    },
                    {
                        name: 'cta_copy', 
                        buttonParamsJson: JSON.stringify({
                            display_text: 'Salin',
                            id: `copy_${url}`
                        })
                    }
                ]
            }
        );
    }

  } catch (err) {
    console.log("Upload error:", err);
    if (platform === 'telegram') {
      await bot.sendMessage(chatId, config.message.error || "❌ Gagal upload file.");
    } else if (platform === 'whatsapp') {
      await bot.sendMessage(chatId, { text: config.message.error || "❌ Gagal upload file." });
    }
  }
};

export default handleMedia;