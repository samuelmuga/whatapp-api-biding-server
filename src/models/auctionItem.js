const mongoose = require('mongoose');

const AuctionItemSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String },
  startAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  highestBidderId: { type: String, default: null },
  highestBidder: { type: String, default: null },
  endTime: { type: Date, required: true },
  extendedAt: { type: Date, default: null },
  groupId: { type: String, required: true },
  status: { type: String, enum: ['open', 'closed', 'cancelled'], default: 'open' },
  createdAt: { type: Date, default: Date.now },
  winner: { type: String, default: null },
  winnerName: { type: String, default: null },
  paymentInstructions: { type: String, default: 'Please make payment via the usual channel and share proof once sent.' },
});

module.exports = mongoose.model('AuctionItem', AuctionItemSchema);
