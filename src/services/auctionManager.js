const AuctionItem = require('../models/auctionItem');
const Bid = require('../models/bid');
const whatsapp = require('./whatsapp');

const BID_EXTENSION_SECONDS = 10;

const parseBidMessage = (messageText) => {
  if (!messageText) return null;
  const cleaned = messageText.trim().toUpperCase();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  let reference;
  let amount;

  if (tokens.length === 2) {
    reference = tokens[0].replace(/^#/, '');
    amount = Number(tokens[1]);
  } else if (tokens.length >= 3 && tokens[0] === 'BID') {
    reference = tokens[1].replace(/^#/, '');
    amount = Number(tokens[2]);
  }

  if (!reference || Number.isNaN(amount)) {
    return null;
  }

  return { reference, amount };
};

const getOpenItem = async (reference) => {
  return AuctionItem.findOne({ reference, status: 'open' });
};

const placeBid = async ({ item, bidderId, bidderName, amount, rawMessage }) => {
  const minimum = item.currentAmount > 0 ? item.currentAmount + 1 : item.startAmount;
  if (amount < minimum) {
    return { success: false, reason: `Bid must be at least ${minimum}` };
  }

  const previousBidder = item.currentBidderId;
  const previousBidderName = item.currentBidderName;
  const previousAmount = item.currentAmount;

  item.currentAmount = amount;
  item.currentBidderId = bidderId;
  item.currentBidderName = bidderName;
  item.endTime = new Date(Math.max(item.endTime.getTime(), Date.now() + BID_EXTENSION_SECONDS * 1000));
  item.extendedAt = new Date();
  await item.save();

  await Bid.create({
    itemReference: item.reference,
    bidderId,
    bidderName,
    amount,
    rawMessage,
  });

  await whatsapp.sendPrivateMessage(bidderId, `Congrats ${bidderName}, you are now the highest bidder for ${item.title} at ${amount}.`);

  if (previousBidder && previousBidder !== bidderId) {
    await whatsapp.sendPrivateMessage(previousBidder, `You have been outbid on ${item.title}. Current highest bid is ${amount}.`);
  }

  return { success: true, item, previousAmount, previousBidder, currentAmount: amount };
};

const checkAuctions = async () => {
  const now = new Date();
  const items = await AuctionItem.find({ status: 'open', endTime: { $lte: now } });

  for (const item of items) {
    item.status = 'closed';
    item.winner = item.currentBidderId;
    item.winnerName = item.currentBidderName;
    await item.save();

    const announcement = item.currentBidderId
      ? `🏁 Auction closed for ${item.title} (${item.reference}). Winner: ${item.winnerName} with ${item.currentAmount}. Payment instructions have been sent privately.`
      : `🏁 Auction closed for ${item.title} (${item.reference}) with no bids.`;

    await whatsapp.sendGroupAnnouncement(announcement);

    if (item.currentBidderId) {
      await whatsapp.sendPrivateMessage(
        item.currentBidderId,
        `Congratulations ${item.winnerName}! You won ${item.title} (${item.reference}) for ${item.currentAmount}. ${item.paymentInstructions}`
      );
    }
  }
};

const manualOverride = async ({ reference, action, seconds }) => {
  const item = await AuctionItem.findOne({ reference });
  if (!item) return { success: false, reason: 'Item not found' };

  if (action === 'close') {
    item.endTime = new Date();
    await item.save();
    return { success: true, item };
  }

  if (action === 'extend') {
    const extensionMs = Number(seconds || BID_EXTENSION_SECONDS) * 1000;
    item.endTime = new Date(item.endTime.getTime() + extensionMs);
    await item.save();
    return { success: true, item };
  }

  return { success: false, reason: 'Invalid action' };
};

module.exports = {
  parseBidMessage,
  getOpenItem,
  placeBid,
  checkAuctions,
  manualOverride,
};
