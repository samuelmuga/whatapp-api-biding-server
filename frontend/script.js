// ===============================
// Configuration
// ===============================

const API = window.location.origin;
const ADMIN_SECRET = "my_admin_secret"; // Change this in production

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${ADMIN_SECRET}`,
};

// ===============================
// Elements
// ===============================

const pages = document.querySelectorAll(".page");
const navButtons = document.querySelectorAll(".nav-btn");

// ===============================
// Helpers & Sockets
// ===============================
const socket = io();

socket.on("dashboard:update", (data) => {
  document.getElementById("activeCount").textContent = data.active;
  document.getElementById("endingSoon").textContent = data.endingSoon;
  document.getElementById("completedCount").textContent = data.completed;
  document.getElementById("revenue").textContent = `KES ${data.revenue}`;
});

// Render Active Auctions (Socket Trigger)
function renderAuctions(auctions) {
  const list = document.getElementById("auctionList");
  list.innerHTML = "";

  if (!auctions.length) {
    list.innerHTML = "<div class='empty-state'>No auctions found.</div>";
    return;
  }

  auctions.forEach((item) => {
    const template = document.getElementById("auctionTemplate");
    const card = template.content.cloneNode(true);

    card.querySelector(".auction-title").textContent = item.title || "Untitled";
    card.querySelector(".auction-reference").textContent =
      item.reference || "-";
    card.querySelector(".auction-bid").textContent =
      item.currentAmount ?? item.startAmount ?? 0;
    card.querySelector(".auction-bidder").textContent =
      item.highestBidder || "No bids";
    card.querySelector(".auction-time").textContent = item.endTime
      ? new Date(item.endTime).toLocaleString()
      : "Unknown";

    card
      .querySelector(".extend-btn")
      .addEventListener("click", () => extendAuction(item.reference));
    card
      .querySelector(".close-btn")
      .addEventListener("click", () => closeAuction(item.reference));

    list.appendChild(card);
  });
}

// Render Completed Winners (Socket Trigger)
function renderWinners(winners) {
  const list = document.getElementById("winnerList");
  list.innerHTML = "";

  if (!winners.length) {
    list.innerHTML =
      "<div class='empty-state'>No completed auctions yet.</div>";
    return;
  }

  winners.forEach((item) => {
    const template = document.getElementById("winnerTemplate");
    const card = template.content.cloneNode(true);

    card.querySelector(".winner-title").textContent = item.title || "Untitled";
    card.querySelector(".winner-name").textContent =
      item.highestBidder || "No Winner";
    card.querySelector(".winner-bid").textContent =
      `KES ${item.currentAmount ?? item.startAmount ?? 0}`;

    list.appendChild(card);
  });
}

// Bind socket events to corrected render functions
socket.on("auctions:update", renderAuctions);
socket.on("winners:update", renderWinners);

socket.on("bid:placed", (bid) => {
  console.log("New Bid", bid);
});

socket.on("auction:created", (auction) => {
  console.log("Created", auction);
});

socket.on("auction:closed", (auction) => {
  console.log("Closed", auction);
});

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Server Error");
  }

  return data;
}

// ===============================
// Load Group ID
// ===============================

async function loadGroupId() {
  try {
    const data = await fetchJSON(`${API}/api/group`, { headers });
    const groupField = document.getElementById("groupId");
    if (groupField) {
      groupField.value = data.groupId || "";
    }
  } catch (err) {
    console.error("Group ID Error:", err);
  }
}

// ===============================
// Navigation
// ===============================

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    navButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    pages.forEach((page) => page.classList.remove("active-page"));
    document.getElementById(button.dataset.page).classList.add("active-page");
  });
});

// ===============================
// Dashboard (REST fallback)
// ===============================

async function loadDashboard() {
  try {
    const data = await fetchJSON(`${API}/admin/dashboard`, { headers });

    document.getElementById("activeCount").textContent = data.active ?? 0;
    document.getElementById("endingSoon").textContent = data.endingSoon ?? 0;
    document.getElementById("completedCount").textContent = data.completed ?? 0;
    document.getElementById("revenue").textContent = `KES ${data.revenue ?? 0}`;
  } catch (err) {
    console.error("Dashboard Error:", err);
  }
}

// ===============================
// Load Auctions (REST fallback)
// ===============================

async function loadAuctions() {
  const list = document.getElementById("auctionList");
  list.innerHTML = "";

  try {
    const auctions = await fetchJSON(`${API}/admin/items`, { headers });

    if (!Array.isArray(auctions) || auctions.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          No active auctions found.
        </div>
      `;
      return;
    }

    auctions.forEach((item) => {
      const template = document.getElementById("auctionTemplate");
      const card = template.content.cloneNode(true);

      card.querySelector(".auction-title").textContent =
        item.title || "Untitled";
      card.querySelector(".auction-reference").textContent =
        item.reference || "-";
      card.querySelector(".auction-bid").textContent =
        item.currentAmount ?? item.startAmount ?? 0;
      card.querySelector(".auction-bidder").textContent =
        item.highestBidder || "No bids";
      card.querySelector(".auction-time").textContent = item.endTime
        ? new Date(item.endTime).toLocaleString()
        : "Unknown";

      const extendBtn = card.querySelector(".extend-btn");
      const closeBtn = card.querySelector(".close-btn");

      extendBtn.addEventListener("click", async () => {
        extendBtn.disabled = true;
        try {
          await extendAuction(item.reference);
        } finally {
          extendBtn.disabled = false;
        }
      });

      closeBtn.addEventListener("click", async () => {
        closeBtn.disabled = true;
        try {
          await closeAuction(item.reference);
        } finally {
          closeBtn.disabled = false;
        }
      });

      list.appendChild(card);
    });
  } catch (err) {
    console.error("Auction Load Error:", err);
    list.innerHTML = `
      <div class="empty-state">
        Failed to load auctions.
      </div>
    `;
  }
}

// ===============================
// Load Winners (REST fallback)
// ===============================

async function loadWinners() {
  const list = document.getElementById("winnerList");
  list.innerHTML = "";

  try {
    const winners = await fetchJSON(`${API}/admin/winners`, { headers });

    if (!Array.isArray(winners) || winners.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          No completed auctions yet.
        </div>
      `;
      return;
    }

    winners.forEach((item) => {
      const template = document.getElementById("winnerTemplate");
      const card = template.content.cloneNode(true);

      card.querySelector(".winner-title").textContent =
        item.title || "Untitled";
      card.querySelector(".winner-name").textContent =
        item.highestBidder || "No Winner";
      card.querySelector(".winner-bid").textContent =
        `KES ${item.currentAmount ?? item.startAmount ?? 0}`;

      list.appendChild(card);
    });
  } catch (err) {
    console.error("Winner Error:", err);
    list.innerHTML = `
      <div class="empty-state">
        Failed to load winners.
      </div>
    `;
  }
}

// ===============================
// Create Auction
// ===============================

document
  .getElementById("auctionForm")
  .addEventListener("submit", async function (e) {
    e.preventDefault();
    const submitBtn = this.querySelector("button[type='submit']");
    submitBtn.disabled = true;

    try {
      const body = {
        reference: document.getElementById("reference").value.trim(),
        title: document.getElementById("title").value.trim(),
        description: document.getElementById("description").value.trim(),
        startAmount: Number(document.getElementById("startAmount").value),
        endTime: document.getElementById("endTime").value,
        groupId: document.getElementById("groupId").value.trim(),
      };

      await fetchJSON(`${API}/admin/items`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      alert("Auction created successfully.");
      this.reset();
      await loadGroupId();
      await Promise.all([loadDashboard(), loadAuctions()]);
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

// ===============================
// Extend Auction
// ===============================

async function extendAuction(reference) {
  try {
    await fetchJSON(`${API}/admin/override`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reference,
        action: "extend",
        seconds: 30,
      }),
    });
    await Promise.all([loadDashboard(), loadAuctions()]);
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

// ===============================
// Close Auction
// ===============================

async function closeAuction(reference) {
  if (!confirm("Close this auction?")) return;

  try {
    await fetchJSON(`${API}/admin/override`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reference,
        action: "close",
      }),
    });

    await Promise.all([loadDashboard(), loadAuctions(), loadWinners()]);
    alert("Auction closed successfully.");
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
}

// ===============================
// Refresh Button
// ===============================

const refreshBtn = document.getElementById("refreshBtn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";
    try {
      await refreshAll();
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh";
    }
  });
}

// ===============================
// Auto Refresh (Fallback Polling)
// ===============================

let refreshing = false;
setInterval(async () => {
  if (refreshing) return;
  refreshing = true;
  try {
    await Promise.all([loadDashboard(), loadAuctions()]);
  } catch (err) {
    console.error("Auto Refresh:", err);
  } finally {
    refreshing = false;
  }
}, 5000);

// ===============================
// Utility
// ===============================

async function refreshAll() {
  try {
    await Promise.all([loadDashboard(), loadAuctions(), loadWinners()]);
  } catch (err) {
    console.error(err);
  }
}

// ===============================
// Logout (Optional)
// ===============================

function logout() {
  if (!confirm("Logout from the admin panel?")) return;
  localStorage.removeItem("adminToken");
  location.href = "login.html";
}

// ===============================
// Startup
// ===============================

(async function init() {
  try {
    await loadGroupId();
    await refreshAll();
    console.log("Admin Panel Ready");
  } catch (err) {
    console.error("Initialization Error:", err);
  }
})();
