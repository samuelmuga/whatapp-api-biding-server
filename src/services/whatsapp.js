const axios = require("axios");
const config = require("../config");

const client = axios.create({
  baseURL: config.whatsappApiUrl,
  timeout: 10000,
  headers: {
    Authorization: `Bearer ${config.whatsappToken}`,
    "Content-Type": "application/json",
  },
});

// ===============================
// Core Sender
// ===============================

async function send(payload) {
  try {
    const response = await client.post("", payload);

    console.log(`✓ WhatsApp message sent (${payload.type}) -> ${payload.to}`);

    return response.data;
  } catch (err) {
    console.error("WhatsApp Error:", err.response?.data || err.message);

    throw err;
  }
}

// ===============================
// Text Message
// ===============================

async function sendText(to, text) {
  return send({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text,
    },
  });
}

// ===============================
// Group Announcement
// ===============================

async function sendGroupAnnouncement(text) {
  if (!config.whatsappGroupId)
    throw new Error("WHATSAPP_GROUP_ID not configured.");

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
  return send({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: {
      link: imageUrl,
      caption,
    },
  });
}

// ===============================
// Document
// ===============================

async function sendDocument(to, documentUrl, filename = "document.pdf") {
  return send({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: {
      link: documentUrl,
      filename,
    },
  });
}

// ===============================
// Location
// ===============================

async function sendLocation(to, latitude, longitude, name = "", address = "") {
  return send({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "location",
    location: {
      latitude,
      longitude,
      name,
      address,
    },
  });
}

// ===============================
// Button Message
// ===============================

async function sendButtons(to, body, buttons) {
  return send({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: body,
      },
      action: {
        buttons: buttons.map((button, index) => ({
          type: "reply",
          reply: {
            id: `btn_${index + 1}`,
            title: button,
          },
        })),
      },
    },
  });
}

// ===============================
// List Message
// ===============================

async function sendList(to, body, buttonText, sections) {
  return send({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: body,
      },
      action: {
        button: buttonText,
        sections,
      },
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

🔖 Ref: ${auction.reference}

⏰ Ends: ${new Date(auction.endTime).toLocaleString()}

Place your bid by replying:

BID ${auction.reference} <amount>`;

    return sendText(groupId, message);

}

// ===============================

async function sendNewHighestBid(groupId, auction, bidder, amount) {

    const message = `🔥 *NEW HIGHEST BID*

🏷️ ${auction.title}

👤 Bidder: ${bidder}

💰 Highest Bid: KES ${amount}

Reply with

BID ${auction.reference} <amount>

to outbid.`;

    return sendText(groupId, message);

}

// ===============================

async function sendAuctionExtended(groupId, auction, seconds) {

    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;

    const message = `⏳ *AUCTION EXTENDED*

🏷️ ${auction.title}

Extra Time:

${minutes} minute(s) ${remaining} second(s)

Good luck bidding!`;

    return sendText(groupId, message);

}

// ===============================

async function sendAuctionEndingSoon(groupId, auction, minutesLeft) {

    const message = `⚠️ *ENDING SOON*

🏷️ ${auction.title}

Current Bid:

KES ${auction.currentAmount}

Only ${minutesLeft} minute(s) remaining!

Reply

BID ${auction.reference} <amount>

before time runs out.`;

    return sendText(groupId, message);

}

// ===============================

async function sendOutBid(privateNumber, auction, amount) {

    const message = `😔 You have been outbid.

Auction:

${auction.title}

Current Highest Bid:

KES ${amount}

Reply:

BID ${auction.reference} <amount>

to bid again.`;

    return sendPrivateMessage(privateNumber, message);

}

// ===============================

async function sendWinner(privateNumber, auction) {

    const message = `🎉 Congratulations!

You won the auction.

🏷️ ${auction.title}

Winning Bid:

KES ${auction.currentAmount}

Reference:

${auction.reference}

An administrator will contact you shortly.`;

    return sendPrivateMessage(privateNumber, message);

}

// ===============================

async function sendLoser(privateNumber, auction) {

    const message = `Auction Closed

Unfortunately you did not win

🏷️ ${auction.title}

Better luck in the next auction!`;

    return sendPrivateMessage(privateNumber, message);

}

// ===============================

async function sendAuctionClosed(groupId, auction) {

    const message = `🔒 *AUCTION CLOSED*

🏷️ ${auction.title}

🏆 Winner:

${auction.highestBidder}

💰 Winning Bid:

KES ${auction.currentAmount}

Thank you everyone for participating.`;

    return sendText(groupId, message);

}

// ===============================

async function sendPaymentInstructions(privateNumber, auction, amount, paybill, account) {

    const message = `💳 PAYMENT REQUIRED

Congratulations!

Auction:

${auction.title}

Amount:

KES ${amount}

PayBill:

${paybill}

Account:

${account}

Please send payment and await confirmation.`;

    return sendPrivateMessage(privateNumber, message);

}

// ===============================

async function sendPaymentConfirmed(privateNumber, auction) {

    const message = `✅ Payment Confirmed

Thank you for purchasing

${auction.title}

Your order is now being processed.`;

    return sendPrivateMessage(privateNumber, message);

}

// ===============================

async function sendAuctionCancelled(groupId, auction) {

    const message = `❌ AUCTION CANCELLED

${auction.title}

Reference:

${auction.reference}

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