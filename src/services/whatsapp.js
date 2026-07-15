const axios = require("axios");
const config = require("../config");

// Provider detection.
//  - "meta"  : official WhatsApp Cloud API (graph.facebook.com). Individual
//              DMs only - Meta does not support sending to groups.
//  - "whapi" : Whapi.cloud gateway. Supports both DMs and group messages.
const PROVIDER =
  (config.whatsappProvider || "").toLowerCase() === "meta"
    ? "meta"
    : (config.whatsappProvider || "").toLowerCase() === "whapi"
    ? "whapi"
    : /graph\.facebook\.com/i.test(config.whatsappApiUrl || "")
    ? "meta"
    : "whapi";

const META_URL = config.whatsappApiUrl;
const WHAPI_URL = (config.whatsappApiUrl || "https://gate.whapi.cloud").replace(/\/?$/, "/");

const whapiClient = axios.create({
  baseURL: WHAPI_URL,
  timeout: 10000,
  headers: {
    Authorization: `Bearer ${config.whatsappToken}`,
    "Content-Type": "application/json",
  },
});

const metaClient = axios.create({
  timeout: 10000,
  headers: {
    Authorization: `Bearer ${config.whatsappToken}`,
    "Content-Type": "application/json",
  },
});

// ===============================
// Core Senders
// ===============================
async function whapiSend(endpoint, payload) {
  try {
    const clean = endpoint.replace(/^\//, "");
    const response = await whapiClient.post(clean, payload);
    console.log(`✓ Whapi message sent (${clean}) -> ${payload.to}`);
    return response.data;
  } catch (err) {
    console.error("Whapi send error:", err.response?.data || err.message);
    // Notifications are best-effort: never abort the auction operation or
    // leak upstream errors to the client.
    return null;
  }
}

async function metaSend(payload) {
  try {
    const response = await metaClient.post(META_URL, payload);
    console.log(`✓ Meta message sent -> ${payload.to}`);
    return response.data;
  } catch (err) {
    console.error("Meta send error:", err.response?.data || err.message);
    return null;
  }
}

// ===============================
// Text Message (provider aware)
// ===============================
async function sendText(to, text) {
  if (PROVIDER === "meta") {
    return metaSend({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    });
  }
  return whapiSend("messages/text", { to, body: text });
}

// ===============================
// Group Announcement
// ===============================
async function sendGroupAnnouncement(text) {
  if (!config.whatsappGroupId) {
    console.warn("WHATSAPP_GROUP_ID not configured; skipping group announcement.");
    return null;
  }
  if (PROVIDER === "meta") {
    console.warn("Meta/Cloud API does not support group messages; skipping group announcement.");
    return null;
  }
  return sendText(config.whatsappGroupId, text);
}

// ===============================
// Private Message
// ===============================
async function sendPrivateMessage(phone, text) {
  return sendText(phone, text);
}

// ===============================
// Image
// ===============================
async function sendImage(to, imageUrl, caption = "") {
  if (PROVIDER === "meta") {
    console.warn("sendImage is only supported on Whapi; skipping.");
    return null;
  }
  return whapiSend("messages/image", {
    to,
    media: imageUrl, // Whapi uses 'media' for file URLs
    caption,
  });
}

// ===============================
// Document
// ===============================
async function sendDocument(to, documentUrl, filename = "document.pdf") {
  if (PROVIDER === "meta") {
    console.warn("sendDocument is only supported on Whapi; skipping.");
    return null;
  }
  return whapiSend("messages/document", {
    to,
    media: documentUrl, // Whapi uses 'media' for file URLs
    caption: filename, // In Whapi, caption acts as the title/filename view
  });
}

// ===============================
// Location
// ===============================
async function sendLocation(to, latitude, longitude, name = "", address = "") {
  if (PROVIDER === "meta") {
    console.warn("sendLocation is only supported on Whapi; skipping.");
    return null;
  }
  return whapiSend("messages/location", {
    to,
    latitude,
    longitude,
    name,
    address,
  });
}

// ===============================
// Button Message
// ===============================
async function sendButtons(to, body, buttons) {
  if (PROVIDER === "meta") {
    console.warn("sendButtons is only supported on Whapi; skipping.");
    return null;
  }
  return whapiSend("messages/interactive", {
    to,
    type: "button",
    body: {
      text: body,
    },
    action: {
      buttons: buttons.map((button, index) => ({
        type: "reply",
        reply: {
          id: `btn_${index + 1}`,
          title: button, // Max 20 characters limit
        },
      })),
    },
  });
}

// ===============================
// List Message
// ===============================
async function sendList(to, body, buttonText, sections) {
  if (PROVIDER === "meta") {
    console.warn("sendList is only supported on Whapi; skipping.");
    return null;
  }
  return whapiSend("messages/interactive", {
    to,
    type: "list",
    body: {
      text: body,
    },
    action: {
      button: buttonText,
      sections,
    },
  });
}

// ===============================
// Auction Notifications
// ===============================
async function sendAuctionCreated(groupId, auction) {
  const message = `🆕 *NEW AUCTION*

🏷️ ${auction.title}

📝 ${auction.description}

💰 Starting Price: KES ${auction.startAmount}

Ref: *#${auction.reference}*

⏰ Ends: ${new Date(auction.endTime).toLocaleString()}

Place your bid by replying:
*BID ${auction.reference} <amount>*`;

  return sendText(groupId, message);
}

// ===============================
async function sendNewHighestBid(groupId, auction, bidder, amount) {
  const message = `🔥 *NEW HIGHEST BID*

🏷️ ${auction.title}

👤 Bidder: ${bidder}

💰 Highest Bid: KES ${amount}

Reply with:
*BID ${auction.reference} <amount>*
to outbid!`;

  return sendText(groupId, message);
}

// ===============================
async function sendAuctionExtended(groupId, auction, seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;

  const timeStr =
    minutes > 0
      ? `${minutes} minute(s) ${remaining} second(s)`
      : `${remaining} second(s)`;

  const message = `⏳ *AUCTION EXTENDED*

🏷️ ${auction.title}

Extra Time added:
*${timeStr}*

Good luck bidding!`;

  return sendText(groupId, message);
}

// ===============================
async function sendAuctionEndingSoon(groupId, auction, minutesLeft) {
  const message = `⚠️ *ENDING SOON*

🏷️ ${auction.title}

Current Bid:
*KES ${auction.currentAmount || auction.startAmount}*

Only *${minutesLeft}* minute(s) remaining!

Reply:
*BID ${auction.reference} <amount>*
before time runs out!`;

  return sendText(groupId, message);
}

// ===============================
async function sendOutBid(privateNumber, auction, amount) {
  const message = `😔 You have been outbid on:
*${auction.title}*

Current Highest Bid:
*KES ${amount}*

Reply:
*BID ${auction.reference} <amount>*
to reclaim your lead!`;

  return sendPrivateMessage(privateNumber, message);
}

// ===============================
async function sendWinner(privateNumber, auction) {
  const message = `🎉 *CONGRATULATIONS!*
You won the auction!

🏷️ ${auction.title}
💰 Winning Bid: *KES ${auction.currentAmount}*
🔖 Reference: *#${auction.reference}*

An administrator will contact you shortly with payment instructions.`;

  return sendPrivateMessage(privateNumber, message);
}

// ===============================
async function sendLoser(privateNumber, auction) {
  const message = `🏁 *Auction Closed*

Unfortunately, you did not win:
🏷️ *${auction.title}*

Better luck in the next run!`;

  return sendPrivateMessage(privateNumber, message);
}

// ===============================
async function sendAuctionClosed(groupId, auction) {
  const message = `🔒 *AUCTION CLOSED*

🏷️ ${auction.title}

🏆 Winner:
*${auction.winnerName || auction.highestBidder || "No winner"}*

💰 Winning Bid:
*KES ${auction.currentAmount || "N/A"}*

Thank you everyone for participating!`;

  return sendText(groupId, message);
}

// ===============================
async function sendPaymentInstructions(
  privateNumber,
  auction,
  amount,
  paybill,
  account,
) {
  const message = `💳 *PAYMENT REQUIRED*

Congratulations!

Auction:
*${auction.title}*

Amount Due:
*KES ${amount}*

PayBill:
*${paybill}*

Account:
*${account}*

Please send payment and await confirmation.`;

  return sendPrivateMessage(privateNumber, message);
}

// ===============================
async function sendPaymentConfirmed(privateNumber, auction) {
  const message = `✅ *Payment Confirmed*

Thank you for purchasing:
*${auction.title}*

Your order is now being processed!`;

  return sendPrivateMessage(privateNumber, message);
}

// ===============================
async function sendAuctionCancelled(groupId, auction) {
  const message = `❌ *AUCTION CANCELLED*

*${auction.title}*
Reference: *#${auction.reference}*

This auction has been cancelled by the administrator.`;

  return sendText(groupId, message);
}

module.exports = {
  sendText,
  sendPrivateMessage,
  sendGroupAnnouncement,
  sendImage,
  sendDocument,
  sendLocation,
  sendButtons,
  sendList,
  sendAuctionCreated,
  sendNewHighestBid,
  sendAuctionExtended,
  sendAuctionEndingSoon,
  sendOutBid,
  sendWinner,
  sendLoser,
  sendAuctionClosed,
  sendPaymentInstructions,
  sendPaymentConfirmed,
  sendAuctionCancelled,
};
