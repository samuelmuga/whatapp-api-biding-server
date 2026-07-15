// =====================================================
// IMPORTS
// =====================================================

const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");

const config = require("./config");
const auctionManager = require("./services/auctionManager");
const whatsapp = require("./services/whatsapp");

const AuctionItem = require("./models/auctionItem");
const Bid = require("./models/bid");

// =====================================================
// EXPRESS
// =====================================================

const app = express();
const server = http.createServer(app);

// =====================================================
// SOCKET.IO
// =====================================================

const { Server } = require("socket.io");

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.set("io", io);

io.on("connection", (socket) => {
    console.log(`Socket Connected: ${socket.id}`);

    socket.on("disconnect", () => {
        console.log(`Socket Disconnected: ${socket.id}`);
    });
});

// =====================================================
// SETTINGS
// =====================================================

app.use(cors());

app.use(
  express.json({
    limit: "2mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
  }),
);

app.use(express.static("frontend"));

// =====================================================
// REQUEST LOGGER
// =====================================================

app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    console.log(
      `[${new Date().toISOString()}] ` +
        `${req.method} ${req.originalUrl} ` +
        `${res.statusCode} ` +
        `${Date.now() - start}ms`,
    );
  });

  next();
});

// =====================================================
// SECURITY HEADERS
// =====================================================

app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "Auction System");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

// =====================================================
// ASYNC WRAPPER
// =====================================================

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// =====================================================
// ADMIN AUTHORIZATION
// =====================================================

const authorizeAdmin = (req, res, next) => {
  if (!config.adminSecret) {
    return res.status(500).json({
      error: "ADMIN_SECRET is not configured.",
    });
  }

  const auth = req.headers.authorization;

  if (auth !== `Bearer ${config.adminSecret}`) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  next();
};

// =====================================================
// HELPERS
// =====================================================

const dashboardStats = async () => {
  const now = new Date();

  const active = await AuctionItem.countDocuments({
    status: "open",
  });

  const endingSoon = await AuctionItem.countDocuments({
    status: "open",
    endTime: {
      $gte: now,
      $lte: new Date(now.getTime() + 5 * 60 * 1000),
    },
  });

  const completed = await AuctionItem.countDocuments({
    status: "closed",
  });

  const revenue = await AuctionItem.aggregate([
    {
      $match: {
        status: "closed",
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: "$currentAmount",
        },
      },
    },
  ]);

  return {
    active,
    endingSoon,
    completed,
    revenue: revenue[0]?.total || 0,
  };
};

// =====================================================
// SOCKET.IO NOTIFIERS
// =====================================================

const broadcastState = async () => {
  try {
    const stats = await dashboardStats();
    const open = await AuctionItem
      .find({ status: "open" })
      .sort({ endTime: 1 });
    const closed = await AuctionItem
      .find({ status: "closed" })
      .sort({ endTime: -1 });

    io.emit("dashboard:update", stats);
    io.emit("auctions:update", open);
    io.emit("winners:update", closed);
  } catch (err) {
    console.error("broadcastState error:", err);
  }
};

const notifyNewBid = (item, bidderName, amount) => {
  io.emit("bid:placed", {
    reference: item.reference,
    currentAmount: amount,
    highestBidder: bidderName,
    endTime: item.endTime,
  });
};

const notifyAuctionCreated = (item) => {
  io.emit("auction:created", item);
};

const notifyAuctionUpdated = (item) => {
  io.emit("auction:updated", {
    reference: item.reference,
    endTime: item.endTime,
    status: item.status,
  });
};

const notifyAuctionClosed = (item) => {
  io.emit("auction:closed", {
    reference: item.reference,
    winner: item.highestBidder || null,
    amount: item.currentAmount,
  });
};

const notifyAuctionDeleted = (reference) => {
  io.emit("auction:deleted", { reference });
};

// =====================================================
// WEBHOOK HELPERS
// =====================================================

// Supports both the Whapi flat payload and the Meta Cloud API nested payload.
const extractInboundMessage = (event) => {
    if (Array.isArray(event?.messages) && event.messages[0]) {
        const message = event.messages[0];
        return {
            message,
            bidderName: message.profile?.name || event.contacts?.[0]?.profile?.name,
        };
    }

    const value = event?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (message) {
        const contact = Array.isArray(value.contacts)
            ? value.contacts.find((c) => c.wa_id === message.from)
            : null;
        return {
            message,
            bidderName: contact?.profile?.name,
        };
    }

    return null;
};

// =====================================================
// WEBHOOK
// =====================================================

app.post("/webhook", asyncHandler(async (req, res) => {
    const event = req.body;
    const inbound = extractInboundMessage(event);
    const message = inbound?.message;

    if (!message || message.type !== "text") {
        return res.sendStatus(200);
    }

    const bidderId = message.from;
    const bidderName = inbound?.bidderName || bidderId;

    const text = message.text?.body?.trim();

    if (!text) {
        return res.sendStatus(200);
    }

    const parsed = auctionManager.parseBidMessage(text);

    if (!parsed) {
        await whatsapp.sendPrivateMessage(
            bidderId,
            "❌ Invalid bid format.\n\nExample:\nBID TV001 5000"
        );
        return res.sendStatus(200);
    }

    const item = await auctionManager.getOpenItem(parsed.reference);

    if (!item) {
        await whatsapp.sendPrivateMessage(
            bidderId,
            `Auction '${parsed.reference}' was not found or has already closed.`
        );
        return res.sendStatus(200);
    }

    const previousHighestBidder = item.highestBidderId;

    const result = await auctionManager.placeBid({
        item,
        bidderId,
        bidderName,
        amount: parsed.amount,
        rawMessage: text,
    });

    if (!result.success) {
        await whatsapp.sendPrivateMessage(
            bidderId,
            `❌ ${result.reason}`
        );
        return res.json(result);
    }

    await whatsapp.sendPrivateMessage(
        bidderId,
        `✅ Bid accepted!\n\n${item.title}\nCurrent Bid: KES ${parsed.amount}`
    );

    await whatsapp.sendNewHighestBid(
        item.groupId,
        item,
        bidderName,
        parsed.amount
    );

    notifyNewBid(
      item,
      bidderName,
      parsed.amount,
    );

    if (
        previousHighestBidder &&
        previousHighestBidder !== bidderId
    ) {
        await whatsapp.sendOutBid(
            previousHighestBidder,
            item,
            parsed.amount
        );
    }

    await broadcastState();

    res.json({
        success: true
    });
}));

// =====================================================
// API
// =====================================================

app.get("/api/group", (req, res) => {
    res.json({
        groupId: config.whatsappGroupId || ""
    });
});

// =====================================================
// DASHBOARD
// =====================================================

app.get(
    "/admin/dashboard",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const stats = await dashboardStats();
        res.json(stats);
    })
);

// =====================================================
// GET AUCTIONS
// =====================================================

app.get(
    "/admin/items",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const items = await AuctionItem
            .find()
            .sort({
                endTime: 1
            });
        res.json(items);
    })
);

// =====================================================
// CREATE AUCTION
// =====================================================

app.post(
    "/admin/items",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const {
            reference,
            title,
            description,
            startAmount,
            endTime,
            groupId,
        } = req.body;

        if (
            !reference ||
            !title ||
            !startAmount ||
            !endTime ||
            !groupId
        ) {
            return res.status(400).json({
                error: "Missing required fields."
            });
        }

        const exists = await AuctionItem.findOne({
            reference
        });

        if (exists) {
            return res.status(409).json({
                error: "Reference already exists."
            });
        }

        const item = await AuctionItem.create({
            reference,
            title,
            description,
            startAmount,
            currentAmount: startAmount,
            endTime: new Date(endTime),
            groupId,
            status: "open",
            highestBidder: null,
            highestBidderId: null,
        });

        notifyAuctionCreated(item);

        await whatsapp.sendAuctionCreated(
            groupId,
            item
        );

        await broadcastState();

        res.status(201).json({
            success: true,
            item
        });
    })
);

// =====================================================
// WINNERS
// =====================================================

app.get(
    "/admin/winners",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const winners = await AuctionItem
            .find({
                status: "closed"
            })
            .sort({
                endTime: -1
            });
        res.json(winners);
    })
);

// =====================================================
// MANUAL OVERRIDE
// =====================================================

app.post(
    "/admin/override",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const {
            reference,
            action,
            seconds,
        } = req.body;

        if (!reference || !action) {
            return res.status(400).json({
                error: "Reference and action are required."
            });
        }

        const result = await auctionManager.manualOverride({
            reference,
            action,
            seconds,
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.reason,
            });
        }

        const item = result.item;

        switch (action) {
            case "extend":
                await whatsapp.sendAuctionExtended(
                    item.groupId,
                    item,
                    seconds || 30
                );
                notifyAuctionUpdated(item);
                break;

            case "close":
                await whatsapp.sendAuctionClosed(
                    item.groupId,
                    item
                );
                notifyAuctionClosed(item);

                if (item.highestBidderId) {
                    await whatsapp.sendWinner(
                        item.highestBidderId,
                        item
                    );
                }
                break;
        }

        await broadcastState();

        res.json({
            success: true,
            item,
        });
    })
);

// =====================================================
// CANCEL AUCTION
// =====================================================

app.post(
    "/admin/cancel",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const { reference } = req.body;

        if (!reference) {
            return res.status(400).json({
                error: "Reference required."
            });
        }

        const item = await AuctionItem.findOne({
            reference,
        });

        if (!item) {
            return res.status(404).json({
                error: "Auction not found."
            });
        }

        item.status = "cancelled";
        await item.save();

        notifyAuctionUpdated(item);

        await whatsapp.sendAuctionCancelled(
            item.groupId,
            item
        );

        await broadcastState();

        res.json({
            success: true,
            item,
        });
    })
);

// =====================================================
// STATISTICS
// =====================================================

app.get(
    "/admin/statistics",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const highestBid = await AuctionItem
            .findOne()
            .sort({
                currentAmount: -1
            });

        const activeAuctions =
            await AuctionItem.countDocuments({
                status: "open"
            });

        const completedAuctions =
            await AuctionItem.countDocuments({
                status: "closed"
            });

        const todayRevenue = await AuctionItem.aggregate([
            {
                $match: {
                    status: "closed",
                    updatedAt: {
                        $gte: today
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    total: {
                        $sum: "$currentAmount"
                    }
                }
            }
        ]);

        res.json({
            todayRevenue: todayRevenue[0]?.total || 0,
            highestBid: highestBid?.currentAmount || 0,
            highestAuction: highestBid?.title || null,
            activeAuctions,
            completedAuctions,
        });
    })
);

// =====================================================
// BID HISTORY
// =====================================================

app.get(
    "/admin/items/:reference/bids",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const item = await AuctionItem.findOne({
            reference: req.params.reference,
        });

        if (!item) {
            return res.status(404).json({
                error: "Auction not found."
            });
        }

        const bids = await Bid
            .find({ itemReference: req.params.reference })
            .sort({ timestamp: -1 });

        res.json({
            auction: item.title,
            bids,
        });
    })
);

// =====================================================
// DELETE AUCTION
// =====================================================

app.delete(
    "/admin/items/:reference",
    authorizeAdmin,
    asyncHandler(async (req, res) => {
        const item = await AuctionItem.findOne({
            reference: req.params.reference,
        });

        if (!item) {
            return res.status(404).json({
                error: "Auction not found."
            });
        }

        await item.deleteOne();
        notifyAuctionDeleted(item.reference);

        await broadcastState();

        res.json({
            success: true,
            message: "Auction deleted.",
        });
    })
);

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (req, res) => {
    res.json({
        status: "OK",
        uptime: process.uptime(),
        timestamp: new Date(),
        mongodb:
            mongoose.connection.readyState === 1
                ? "Connected"
                : "Disconnected",
        environment:
            process.env.NODE_ENV || "development",
    });
});

// =====================================================
// DATABASE EVENTS
// =====================================================

mongoose.connection.on("connected", () => {
    console.log("✓ MongoDB Connected");
});

mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB Disconnected");
});

mongoose.connection.on("error", (err) => {
    console.error("MongoDB Error");
    console.error(err);
});

// =====================================================
// AUCTION SCHEDULER
// =====================================================

async function auctionScheduler() {
    try {
        await auctionManager.checkAuctions();
    } catch (err) {
        console.error(
            "Auction Scheduler Error:",
            err
        );
    }
}

// =====================================================
// MEMORY MONITOR
// =====================================================

setInterval(() => {
    const used = process.memoryUsage();
    console.log(
        `Memory: ${Math.round(
            used.heapUsed / 1024 / 1024
        )} MB`
    );
}, 60000);

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    error: err.message || "Internal Server Error",
  });
});

// =====================================================
// NOT FOUND
// =====================================================

app.use((req, res) => {
    res.status(404).json({
        error: "Route not found.",
    });
});

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

async function shutdown(signal) {
    console.log(`Received ${signal}`);
    console.log("Closing server...");

    server.close(async () => {
        console.log("HTTP Server Closed");
        try {
            await mongoose.disconnect();
            console.log("MongoDB Closed");
        } catch (err) {
            console.error(err);
        }
        process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// =====================================================
// START SERVER
// =====================================================

async function start() {
    if (!config.mongoUri) {
        throw new Error("MONGODB_URI not configured.");
    }

    await mongoose.connect(config.mongoUri);
    console.log("MongoDB Ready");

    server.listen(config.port, () => {
        console.log("===================================");
        console.log("Auction Server Started");
        console.log(`Port : ${config.port}`);
        console.log(`Environment : ${process.env.NODE_ENV || "development"}`);
        console.log("===================================");
    });

    setInterval(
        auctionScheduler,
        config.checkIntervalSeconds * 1000
    );
}

start().catch(err => {
    console.error(err);
    process.exit(1);
});