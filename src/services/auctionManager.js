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

  item.currentAmount = amount;
  item.highestBidderId = bidderId;
  item.highestBidder = bidderName;
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

  return { success: true, item, currentAmount: amount };
};

const closeItem = async (item) => {
  item.status = 'closed';
  item.winner = item.highestBidderId;
  item.winnerName = item.highestBidder;
  await item.save();
  return item;
};

const checkAuctions = async () => {
  const now = new Date();
  const items = await AuctionItem.find({ status: 'open', endTime: { $lte: now } });

  for (const item of items) {
    await closeItem(item);

    const announcement = item.winner
      ? `🏁 Auction closed for ${item.title} (${item.reference}). Winner: ${item.winnerName} with ${item.currentAmount}. Payment instructions have been sent privately.`
      : `🏁 Auction closed for ${item.title} (${item.reference}) with no bids.`;

    await whatsapp.sendGroupAnnouncement(announcement);

    if (item.winner) {
      await whatsapp.sendPrivateMessage(
        item.winner,
        `Congratulations ${item.winnerName}! You won ${item.title} (${item.reference}) for ${item.currentAmount}. ${item.paymentInstructions}`
      );
    }
  }
};

const manualOverride = async ({ reference, action, seconds }) => {
  const item = await AuctionItem.findOne({ reference });
  if (!item) return { success: false, reason: 'Item not found' };

  if (action === 'close') {
    if (item.status === 'closed') {
      return { success: false, reason: 'Auction is already closed.' };
    }
    await closeItem(item);
    return { success: true, item };
  }

  if (action === 'extend') {
    if (item.status !== 'open') {
      return { success: false, reason: 'Only open auctions can be extended.' };
    }
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
