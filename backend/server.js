const http = require("http");
const { Server } = require("socket.io");
const express = require("express");
const path = require("path");
const { MongoClient, ObjectId, Decimal128 } = require("mongodb");
const session = require("express-session");
const bcrypt = require("bcrypt");
const cron = require("node-cron");
const axios = require("axios");
const MongoStore = require("connect-mongo"); //NEW SESSION
const { createAdapter } = require("@socket.io/redis-adapter");
const { createClient } = require("redis");


const app = express();
app.use(express.json());

//TESTING LOAD BALANCING
app.use((req, res, next) => {
  console.log("Handled by container:", require("os").hostname());
  next();
});

// Logging 
function audit(req, action, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    action,
    userId: req.session?.userId || null,
    username: req.session?.username || null,
    ip:
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null,
    method: req.method,
    path: req.originalUrl,
    details
  };

  console.log(JSON.stringify(entry));
}


// Session middleware
/*
app.use(session({
  secret: 'finance-system-secret-key-2024', // key
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24
  }
}));
*/



//NEW SESSION CODE
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error("MONGO_URI not set");

const sessionMiddleware = session({
  store: MongoStore.default.create({
    mongoUrl: MONGO_URI,
    collectionName: "sessions"
  }),
  secret: "finance-system-secret-key-2024",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // IMPORTANT: nginx note below
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24
  }
});

app.use(sessionMiddleware);

// END OF NEW SESSION CODE


// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
// const MONGO_URI = process.env.MONGO_URI;

// Connect to Mongo
let db, expensesCol, budgetsCol, usersCol, budgetCacheCol, reportsCol;



async function connectMongo() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  
  db = client.db();
  expensesCol = db.collection("expenses");
  budgetsCol = db.collection("budget");
  usersCol = db.collection("users");
  budgetCacheCol = db.collection("budget_cache");
  reportsCol = db.collection("reports");

  // indexes
  await expensesCol.createIndex({ user_id: 1, date: -1 });
  await expensesCol.createIndex({ user_id: 1, category: 1 });
  await budgetsCol.createIndex({ user_id: 1, budget_category: 1 });
  await budgetCacheCol.createIndex({ user_id: 1, month: 1, category: 1 }, { unique: true });

  console.log("Connected to MongoDB");
}


// Authentication middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// Monthly reports generation function
async function generateMonthlyReportForUser(userId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  // Pull cache
  const cacheRows = await budgetCacheCol.find({
    user_id: userId,
    month: monthKey
  }).toArray();

  if (cacheRows.length === 0) return null;

  // Pull budgets
  const budgets = await budgetsCol.find({ user_id: userId }).toArray();

  const budgetMap = {};
  budgets.forEach(b => {
    budgetMap[b.budget_category] = Number(b.budget_amount.toString());
  });

  let totalSpent = 0;
  let totalBudgeted = 0;
  let totalOverspent = 0;

  const categories = cacheRows.map(row => {
    const spent = row.total;
    const budgeted = budgetMap[row.category] || 0;
    const overspent = Math.max(0, spent - budgeted);

    totalSpent += spent;
    totalBudgeted += budgeted;
    totalOverspent += overspent;

    return {
      category: row.category,
      budgeted,
      spent,
      overspent
    };
  });

  const report = {
    user_id: userId,
    year,
    month,
    total_budgeted: totalBudgeted,
    total_spent: totalSpent,
    total_overspent: totalOverspent,
    categories,
    generated_at: new Date()
  };

  await reportsCol.insertOne(report);

  console.log(
    `Report generated for user ${userId.toString()} (${year}-${month})`
  );

  return report;
}


// Health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Debug endpoint to see users
app.get("/api/debug/users", async (req, res) => {
  try {
    const users = await usersCol.find({}).toArray();
    res.json(users.map(u => ({
      _id: u._id.toString(),
      username: u.user_name,
      password_length: u.user_password?.length || 0
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login endpoint
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  
  try {
    const user = await usersCol.findOne({ user_name: username });
    
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    // Check password
    let passwordValid = false;
    
    if (user.user_password && user.user_password.startsWith('$2b$')) {
      // Password is hashed with bcrypt
      passwordValid = await bcrypt.compare(password, user.user_password);
    } else {

      passwordValid = (password === user.user_password);
      
      if (passwordValid) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await usersCol.updateOne(
          { _id: user._id },
          { $set: { user_password: hashedPassword } }
        );
      }
    }
    
    if (!passwordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    // Update last login time
    await usersCol.updateOne(
      { _id: user._id },
      { $set: { last_login: new Date() } }
    );
    
    // Store user info in session
    req.session.userId = user._id.toString();
    req.session.username = user.user_name;
    
    res.json({
      _id: user._id.toString(),
      username: user.user_name,
      last_login: user.last_login
    });
    
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Registration endpoint
app.post("/api/register", async (req, res) => {
  const { username, password, confirmPassword } = req.body;
  
  // Validation
  if (!username || !password || !confirmPassword) {
    return res.status(400).json({ error: "All fields are required" });
  }
  
  if (password !== confirmPassword) {
    return res.status(400).json({ error: "Passwords do not match" });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  
  if (username.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters" });
  }
  
  // Check for alphanumeric username
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ 
      error: "Username can only contain letters, numbers, and underscores" 
    });
  }
  
  try {
    // Check if username already exists
    const existingUser = await usersCol.findOne({ user_name: username });
    if (existingUser) {
      return res.status(409).json({ error: "Username already taken" });
    }
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user document
    const newUser = {
      user_name: username,
      user_password: hashedPassword,
      created_at: new Date(),
      last_login: null
    };
    
    // Insert into database
    const result = await usersCol.insertOne(newUser);
    
    // Auto-login after registration
    req.session.userId = result.insertedId.toString();
    req.session.username = username;
    
    res.status(201).json({
      _id: result.insertedId.toString(),
      username: username,
      message: "Registration successful"
    });
    
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Check if username is available
app.get("/api/check-username/:username", async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username || username.length < 3) {
      return res.json({ available: false, error: "Username too short" });
    }
    
    const existingUser = await usersCol.findOne({ user_name: username });
    
    res.json({
      available: !existingUser,
      username: username
    });
    
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

// Get current user profile
app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.userId);
    const user = await usersCol.findOne({ _id: userId });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Return user info without password
    res.json({
      _id: user._id.toString(),
      username: user.user_name,
      created_at: user.created_at,
      last_login: user.last_login,
      role: user.role || "user"
    });
    
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Update last login time
app.post("/api/update-last-login", requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.userId);
    
    await usersCol.updateOne(
      { _id: userId },
      { $set: { last_login: new Date() } }
    );
    
    res.json({ ok: true });
    
  } catch (error) {
    console.error("Update last login error:", error);
    res.status(500).json({ error: "Failed to update login time" });
  }
});

// Check auth status
app.get("/api/check-auth", (req, res) => {
  if (req.session.userId) {
    res.json({ 
      authenticated: true,
      username: req.session.username 
    });
  } else {
    res.json({ authenticated: false });
  }
});

// GET all expenses for current user
app.get("/api/expenses", requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.userId);
    
    const docs = await expensesCol
      .find({ user_id: userId })
      .sort({ date: -1 })
      .limit(200)
      .toArray();
    
    // convert Decimal128 to number/string for frontend
    const mapped = docs.map(d => ({
      ...d,
      _id: d._id.toString(),
      amount: d.amount?.toString?.() ?? d.amount,
      date: d.date ? new Date(d.date).toISOString() : null,
      user_id: d.user_id?.toString?.()
    }));
    
    res.json(mapped);
  } catch (error) {
    console.error("Error fetching expenses:", error);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

// POST reports
app.post(
  "/api/reports/debug-generate",
  requireAuth,
  async (req, res) => {
    try {
      const userId = new ObjectId(req.session.userId);

      const report = await generateMonthlyReportForUser(userId);

      if (!report) {
        return res.json({ ok: true, message: "No data to report" });
      }

      res.json({
        ok: true,
        generated_at: report.generated_at
      });

    } catch (err) {
      console.error("DEBUG REPORT ERROR:", err);
      res.status(500).json({ error: "Failed to generate report" });
    }
  }
);


// GET reports
app.get("/api/reports", requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.userId);

    const reports = await reportsCol
      .find({ user_id: userId })
      .sort({ generated_at: -1 })
      .limit(12)
      .toArray();

    res.json(
      reports.map(r => ({
        ...r,
        _id: r._id.toString()
      }))
    );

  } catch (err) {
    console.error("GET REPORTS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// GET reports for exporting .csv
app.get(
  "/api/reports/:id/export/csv",
  requireAuth,
  async (req, res) => {
    try {
      const userId = new ObjectId(req.session.userId);
      const reportId = new ObjectId(req.params.id);

      const report = await reportsCol.findOne({
        _id: reportId,
        user_id: userId
      });

      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }

      // CSV header
      let csv = "Category,Budgeted,Spent,Overspent\n";

      // Category rows
      report.categories.forEach(cat => {
        csv += `${cat.category},${cat.budgeted},${cat.spent},${cat.overspent}\n`;
      });

      // Totals
      csv += "\n";
      csv += `TOTAL,${report.total_budgeted},${report.total_spent},${report.total_overspent}\n`;

      const filename = `budget-report-${report.year}-${String(report.month).padStart(2, "0")}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      // Export report log
      audit(req, "report.export_csv", {
        reportId: req.params.id,
        year: report.year,
        month: report.month
      });

      res.send(csv);

    } catch (err) {
      console.error("CSV EXPORT ERROR:", err);
      audit(req, "report.export_csv_failed", { reportId: req.params.id, error: String(err?.message || err) });
      res.status(500).json({ error: "Failed to export CSV" });
    }
  }
);



// POST create expense
app.post("/api/expenses", requireAuth, async (req, res) => {
  const { amount, date, category, vendor, location, note } = req.body;

  if (amount === undefined || date === undefined) {
    return res.status(400).json({ error: "amount and date are required" });
  }

  const userId = new ObjectId(req.session.userId);

  // =====================
  // FRAUD DETECTION
  // =====================

  const expenseDate = new Date(date);

  const hour = expenseDate.getHours();
  const dayOfWeek = expenseDate.getDay();

  const isWeekend =
    dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0;

  // Default ML payload
  const mlData = {
    Transaction_Amount: Number(amount),
    Is_Weekend: isWeekend,
    Risk_Score: 0.5,
    Hour: hour,
    DayOfWeek: dayOfWeek,

    Location_London: 0,
    Location_Mumbai: 0,
    Location_New_York: 0,
    Location_Sydney: 0,
    Location_Tokyo: 0,

    Merchant_Category_Clothing: 0,
    Merchant_Category_Electronics: 0,
    Merchant_Category_Groceries: 0,
    Merchant_Category_Restaurants: 0,
    Merchant_Category_Travel: 0
  };

  switch ((location || "").toLowerCase()) {
  case "london":
    mlData.Location_London = 1;
    break;

  case "mumbai":
    mlData.Location_Mumbai = 1;
    break;

  case "new york":
    mlData.Location_New_York = 1;
    break;

  case "sydney":
    mlData.Location_Sydney = 1;
    break;

  case "tokyo":
    mlData.Location_Tokyo = 1;
    break;
}

  // Map your categories
  switch ((category || "").toLowerCase()) {
    case "coffee":
    case "restaurant":
    case "food":
      mlData.Merchant_Category_Restaurants = 1;
      break;

    case "groceries":
      mlData.Merchant_Category_Groceries = 1;
      break;

    case "electronics":
      mlData.Merchant_Category_Electronics = 1;
      break;

    case "clothing":
      mlData.Merchant_Category_Clothing = 1;
      break;

    case "travel":
      mlData.Merchant_Category_Travel = 1;
      break;
  }

  let isSuspicious = false;

// TEMP TEST RULE
if ((location || "").toUpperCase() === "FRAUD") {
  isSuspicious = true;
  console.log("TEST FRAUD TRIGGERED");
}

  try {
    const mlResponse = await axios.post(
      "http://localhost:5000/predict",
      mlData
    );

    // Only overwrite if not already forced
  if (!isSuspicious) {
    isSuspicious = mlResponse.data.is_suspicious;
  }

    console.log("Fraud prediction:", isSuspicious);

  } catch (mlError) {
    console.error("ML API ERROR:", mlError.message);
  }

  const expenseDoc = {
    amount: Decimal128.fromString(String(amount)),
    date: new Date(date),
    category: category || "Uncategorized",
    vendor: vendor || "",
    location: location || "",
    note: note || "",
    user_id: userId,
    is_suspicious: isSuspicious,
    created_at: new Date()
  };

  const monthKey =
    `${expenseDoc.date.getFullYear()}-${String(expenseDoc.date.getMonth() + 1).padStart(2, "0")}`;

  let alerts = [];

  const session = db.client.startSession();

  try {
    await session.withTransaction(async () => {
      // 1. Insert expense
      await expensesCol.insertOne(expenseDoc, { session });

      // 2. Check if this category has a budget
      const budget = await budgetsCol.findOne(
        { user_id: userId, budget_category: expenseDoc.category },
        { session }
      );

        if (budget) {
          // 3. Update cache
          await budgetCacheCol.updateOne(
            {
              user_id: userId,
              month: monthKey,
              category: expenseDoc.category
            },
            {
              $inc: { total: Number(amount) },
              $set: { updated_at: new Date() }
            },
            { upsert: true, session }
          );

          const cacheDoc = await budgetCacheCol.findOne(
            {
              user_id: userId,
              month: monthKey,
              category: expenseDoc.category
            },
            { session }
          );

          // 4. Check budget limit
          const limit = Number(budget.budget_amount.toString());
          const spent = cacheDoc.total;

          if (spent > limit) {
            alerts.push({
              type: "category",
              category: expenseDoc.category,
              spent,
              limit
            });
          }
        }
    });

    // Expenses log
    audit(req, "expense.create", {
      amount: Number(amount),
      category: expenseDoc.category,
      date: expenseDoc.date.toISOString(),
      vendor: expenseDoc.vendor || null,
      hasAlerts: alerts.length > 0
    });

      // Budget alerts
      if (alerts.length > 0) {
        const io = req.app.get("io");

        alerts.forEach(a => {
          io.to(`user:${req.session.userId}`).emit("budget_alert", {
            category: a.category,
            spent: a.spent,
            limit: a.limit,
            percentage: a.percentage
          });
        });
      }

      // Fraud alerts
        if (isSuspicious) {
          const io = req.app.get("io");

          console.log("EMITTING TO ROOM:", `user:${req.session.userId}`);

          io.to(`user:${req.session.userId}`).emit("fraud_alert", {
            amount: amount,
            category: category,
            location: location,
            vendor: vendor
          });

          console.log("FRAUD ALERT EMITTED");
        }


    res.status(201).json({
      ok: true,
      alerts
    });

  } catch (err) {
    console.error("Expense insert failed:", err);
    audit(req, "expense.create_failed", { error: String(err?.message || err) });
    res.status(500).json({ error: "Failed to add expense" });
  } finally {
    await session.endSession();
  }
});


// DELETE expense
app.delete("/api/expenses/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  
  try {
    const expenseId = new ObjectId(id);
    const userId = new ObjectId(req.session.userId);
    
    const expense = await expensesCol.findOne({ 
      _id: expenseId,
      user_id: userId 
    });
    
    if (!expense) {
      return res.status(404).json({ error: "Expense not found or not authorized" });
    }

    // Subtract from cache

      // Check if this expense has a budget
      const budget = await budgetsCol.findOne({
        user_id: userId,
        budget_category: expense.category
      });

      if (budget) {
        const expenseDate = new Date(expense.date);
        const monthKey = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, "0")}`;

        await budgetCacheCol.updateOne(
          {
            user_id: userId,
            category: expense.category,
            month: monthKey
          },
          {
            $inc: { total: -Number(expense.amount.toString()) },
            $set: { updated_at: new Date() }
          }
        );
      }

    await expensesCol.deleteOne({ 
      _id: expenseId,
      user_id: userId
    });
    
    // Expense delete log
    audit(req, "expense.delete", {
      expenseId: id,
      category: expense.category,
      amount: Number(expense.amount?.toString?.() ?? expense.amount),
      date: new Date(expense.date).toISOString()
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting expense:", error);
    audit(req, "expense.delete_failed", { expenseId: id, error: String(error?.message || error) });
    res.status(500).json({ error: "Failed to delete expense" });
  }
});


// GET budgets
app.get("/api/budgets", requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.userId);
    
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const budgets = await budgetsCol
      .find({ user_id: userId })
      .toArray();
    
    const budgetsWithSpending = await Promise.all(
      budgets.map(async (budget) => {

        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

        const cacheDoc = await budgetCacheCol.findOne({
          user_id: userId,
          month: monthKey,
          category: budget.budget_category
        });

        const totalSpent = cacheDoc?.total || 0;
        const budgetAmount = parseFloat(budget.budget_amount.toString());
        const remaining = budgetAmount - totalSpent;
        const percentage = budgetAmount > 0 ? (totalSpent / budgetAmount) * 100 : 0;
        
        return {
          ...budget,
          _id: budget._id.toString(),
          budget_amount: budgetAmount,
          spent: totalSpent,
          remaining: remaining,
          percentage: percentage,
          status: percentage > 100 ? "over" : percentage > 80 ? "warning" : "good"
        };
      })
    );
    
    res.setHeader('Content-Type', 'application/json');
    res.json(budgetsWithSpending);
    
  } catch (error) {
    console.error("Error getting budgets with spending:", error);
    res.status(500).json({ error: "Failed to get budgets" });
  }
});

// POST set/update budget
app.post("/api/budgets", requireAuth, async (req, res) => {
  const { budget_category, budget_amount } = req.body;
  
  console.log("POST /api/budgets called with:", { budget_category, budget_amount });
  
  if (!budget_category || budget_amount === undefined || budget_amount === null) {
    console.log("Validation failed: missing fields");
    return res.status(400).json({ error: "Category and amount are required" });
  }
  
  if (budget_amount < 0) {
    console.log("Validation failed: negative amount");
    return res.status(400).json({ error: "Budget amount cannot be negative" });
  }
  
  try {
    const userId = new ObjectId(req.session.userId);
    console.log("User ID:", userId.toString());
    
    const result = await budgetsCol.updateOne(
      { 
        user_id: userId,
        budget_category: budget_category
      },
      { 
        $set: { 
          budget_category: budget_category,
          budget_amount: Decimal128.fromString(String(budget_amount)),
          user_id: userId,
          updated_at: new Date()
        } 
      },
      { upsert: true }
    );

          //  Sum up everything in expenses for the categories

      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Sum existing expenses for this category & month
      const spendingAgg = await expensesCol.aggregate([
        {
          $match: {
            user_id: userId,
            category: budget_category,
            date: { $gte: firstDay, $lte: lastDay }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: "$amount" } }
          }
        }
      ]).toArray();

      const totalSpent = spendingAgg.length > 0 ? spendingAgg[0].total : 0;

      // Upsert cache document
      await budgetCacheCol.updateOne(
        {
          user_id: userId,
          category: budget_category,
          month: monthKey
        },
        {
          $set: {
            total: totalSpent,
            updated_at: new Date()
          }
        },
        { upsert: true }
      );

    
    console.log("MongoDB update result:", result);
    
    // Budget update log
    audit(req, "budget.upsert", {
      category: budget_category,
      amount: Number(budget_amount)
    });

    res.json({ 
      ok: true, 
      message: `Budget for ${budget_category} set to ${budget_amount}€`,
      result: result
    });
    
  } catch (error) {
    console.error("Error setting budget:", error);
    console.error("Error details:", error.message);
    audit(req, "budget.upsert_failed", {
      category: budget_category,
      error: String(error?.message || error)
    });
    res.status(500).json({ 
      error: "Failed to set budget",
      details: error.message 
    });
  }
});

// DELETE budget by category
app.delete("/api/budgets/:category", requireAuth, async (req, res) => {
  const { category } = req.params;
  
  try {
    const userId = new ObjectId(req.session.userId);
    
    const result = await budgetsCol.deleteOne({
      user_id: userId,
      budget_category: category
    });

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    await budgetCacheCol.deleteOne({
      user_id: userId,
      category: category,
      month: monthKey
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Budget not found" });
    }
    
    // Budget delete log
    audit(req, "budget.delete", { category });

    res.json({ 
      ok: true, 
      message: `Budget for ${category} deleted` 
    });
    
  } catch (error) {
    console.error("Error deleting budget:", error);
    audit(req, "budget.delete_failed", { category, error: String(error?.message || error) });
    res.status(500).json({ error: "Failed to delete budget" });
  }
});

// GET budget summary
app.get("/api/budgets/summary", requireAuth, async (req, res) => {
  try {
    const userId = new ObjectId(req.session.userId);
    
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const budgets = await budgetsCol
      .find({ user_id: userId })
      .toArray();
    
    let totalBudgeted = 0;
    budgets.forEach(budget => {
      totalBudgeted += parseFloat(budget.budget_amount.toString());
    });
    
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const cacheTotals = await budgetCacheCol.aggregate([
      {
        $match: {
          user_id: userId,
          month: monthKey
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" }
        }
      }
    ]).toArray();

    const totalSpent = cacheTotals.length > 0 ? cacheTotals[0].total : 0;

    
    res.json({
      total_budgeted: totalBudgeted,
      total_spent: totalSpent,
      total_remaining: totalBudgeted - totalSpent,
      month: now.getMonth() + 1,
      year: now.getFullYear()
    });
    
  } catch (error) {
    console.error("Error getting budget summary:", error);
    res.status(500).json({ error: "Failed to get budget summary" });
  }
});


// Server start
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

async function setupSocketIO() {
  const pubClient = createClient({
    url: "redis://redis:6379"
  });

  const subClient = pubClient.duplicate();

  await pubClient.connect();
  await subClient.connect();

  io.adapter(createAdapter(pubClient, subClient));

  console.log("Socket.IO Redis adapter enabled");
}

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});



app.set("io", io);

io.on("connection", async (socket) => {
  const session = socket.request.session;
  if (!session?.userId) return socket.disconnect(true);

  const userId = new ObjectId(session.userId);
  socket.join(`user:${session.userId}`);

  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const budgets = await budgetsCol.find({ user_id: userId }).toArray();

    for (const budget of budgets) {
      const cacheDoc = await budgetCacheCol.findOne({
        user_id: userId,
        month: monthKey,
        category: budget.budget_category
      });

      const spent = cacheDoc?.total || 0;
      const limit = Number(budget.budget_amount.toString());

      if (spent > limit) {
        io.to(`user:${session.userId}`).emit("budget_alert", {
          category: budget.budget_category,
          spent,
          limit
        });
      }
    }
  } catch (err) {
    console.error("WS login budget check failed:", err);
  }
});



connectMongo()
  .then(async () => {

    await setupSocketIO();

    server.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
      console.log("WebSocket server attached");
    });

  })
  .catch(err => {
    console.error("Mongo connection failed:", err);
    process.exit(1);
  });


// Interval for reports
 /* setInterval(async () => {
  try {
    console.log("Running scheduled report job");

    const users = await budgetsCol.distinct("user_id");

    for (const userId of users) {
      await generateMonthlyReportForUser(userId);
    }

  } catch (err) {
    console.error("SCHEDULED REPORT ERROR:", err);
  }
}, 30 * 1000); // 30 seconds
*/

// Monthly schedule
//min h days(if anything from 28 to 31) month  day of the week
// test value(every 30 seconds): */30 * * * * *
// monthly value: 59 23 28-31 * *
cron.schedule("59 23 28-31 * *", async () => {
  try {
    console.log("Monthly report job started");

    const users = await budgetsCol.distinct("user_id");

    for (const userId of users) {
      await generateMonthlyReportForUser(userId);
    }

    console.log("Monthly report job finished");

  } catch (err) {
    console.error("MONTHLY REPORT ERROR:", err);
  }
});
