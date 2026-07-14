const mongoose = require('mongoose');

const BidSchema = new mongoose.Schema({
  itemReference: { type: String, required: true, index: true },
  bidderId: { type: String, required: true },
  bidderName: { type: String, required: true },
  amount: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  rawMessage: { type: String },
});

module.exports = mongoose.model('Bid', BidSchema);
