// base URL for API
const API = "/api";

const form = document.getElementById("expenseForm");
const list = document.getElementById("expensesList");

// Real time notification stuff
let socket;
let toastContainer = document.getElementById("toast-container");

if (!toastContainer) {
  toastContainer = document.createElement("div");
  toastContainer.id = "toast-container";
  document.body.appendChild(toastContainer);
}

// Display all expenses
async function loadExpenses() {
  try {
    const res = await fetch(`${API}/expenses`);
    const expenses = await res.json();

    list.innerHTML = "";
    expenses.forEach(e => {
      const li = document.createElement("li");
      const d = e.date ? e.date.slice(0, 10) : "";
      li.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
          <div>
            <strong>${Number(e.amount).toFixed(2)}€</strong>
            <span>• ${d}</span>
            <div style="font-size:12px;opacity:.8">${e.category || ""} ${e.vendor ? "• " + e.vendor : ""}${e.location ? "• " + e.location : ""}</div>
            <div style="font-size:12px;opacity:.7">${e.note || ""}</div>
          </div>
          <button data-id="${e._id}">Delete</button>
        </div>
      `;
      li.querySelector("button").addEventListener("click", async () => {
        await fetch(`${API}/expenses/${e._id}`, { method: "DELETE" });
        loadExpenses();
        loadBudgets();
      });
      list.appendChild(li);
    });
  } catch (error) {
    console.error('Error loading expenses:', error);
  }
}


// Load user profile
async function loadUserProfile() {
  try {
    const userInfoEl = document.getElementById('userInfo');
    if (!userInfoEl) return;
    
    const user = JSON.parse(localStorage.getItem('finance_user') || '{}');
    userInfoEl.innerHTML = `Logged in as: <strong>${user.username || 'User'}</strong>`;
    
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

// Load budgets
async function loadBudgets() {
  try {
    console.log('Loading budgets...');
    
    const authCheck = await fetch(`${API}/check-auth`);
    const authData = await authCheck.json();
    
    if (!authData.authenticated) {
      console.log('Not authenticated, redirecting...');
      localStorage.removeItem('finance_user');
      window.location.href = '/login.html';
      return;
    }
    
    const response = await fetch(`${API}/budgets`);
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('Non-JSON response received:', text.substring(0, 200));
      
      if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('Login')) {
        throw new Error('Session expired or not authenticated. Redirecting to login...');
      }
      throw new Error(`Server returned ${contentType} instead of JSON`);
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const budget = await response.json();
    console.log('Budgets loaded:', budget);
    
    const budgetsList = document.getElementById('budgetsList');
    const budgetSummary = document.getElementById('budgetSummary');
    
    if (!budgetsList) {
      console.error('budgetsList element not found!');
      return;
    }
    
    budgetsList.innerHTML = "";
    
    if (!budget || budget.length === 0) {
      budgetsList.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #666; background: #f8f9fa; border-radius: 4px;">
          No budgets set. Click "Add Budget" to create one.
        </div>
      `;
      if (budgetSummary) budgetSummary.style.display = 'none';
      return;
    }
    
    // Calculate totals
    let totalBudgeted = 0;
    let totalSpent = 0;
    
    budget.forEach(budget => {
      const budgetAmount = budget.budget_amount || 0;
      const spent = budget.spent || 0;
      const category = budget.budget_category || 'Uncategorized';
      
      totalBudgeted += parseFloat(budgetAmount);
      totalSpent += parseFloat(spent);
      
      const remaining = budgetAmount - spent;
      const percentage = budgetAmount > 0 ? (spent / budgetAmount) * 100 : 0;
      
      let progressClass = 'progress-good';
      if (percentage > 100) progressClass = 'progress-over';
      else if (percentage > 80) progressClass = 'progress-warning';
      
      const budgetItem = document.createElement('div');
      budgetItem.className = 'budget-item';
      budgetItem.innerHTML = `
        <div class="budget-header">
          <span class="budget-category">${category}</span>
          <span class="budget-amounts">
            <span style="color: #28a745;">${parseFloat(spent).toFixed(2)}€</span> / 
            <span style="color: #007bff;">${parseFloat(budgetAmount).toFixed(2)}€</span>
            <span style="margin-left: 10px; color: ${remaining >= 0 ? '#28a745' : '#dc3545'}">
              ${remaining >= 0 ? 'Remaining:' : 'Overspent:'} ${Math.abs(remaining).toFixed(2)}€
            </span>
          </span>
        </div>
        
        <div class="budget-progress-container">
          <div class="budget-progress-bar ${progressClass}" 
               style="width: ${Math.min(percentage, 100)}%"></div>
        </div>
        
        <div class="budget-percentage">
          ${percentage.toFixed(1)}% of budget used
        </div>
        
        <div class="budget-actions">
          <button class="edit-budget" data-category="${category}">Edit</button>
          <button class="delete-budget" data-category="${category}">Delete</button>
        </div>
      `;
      
      budgetsList.appendChild(budgetItem);
    });

    document.querySelectorAll('.delete-budget').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const category = e.target.dataset.category;
        if (confirm(`Delete budget for ${category}?`)) {
          await fetch(`${API}/budgets/${encodeURIComponent(category)}`, { method: "DELETE" });
          loadBudgets();
        }
      });
    });

    document.querySelectorAll('.edit-budget').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const category = e.target.dataset.category;
        const budgetObj = budget.find(b => (b.budget_category || 'Uncategorized') === category);
        if (!budgetObj) return;

        startEditBudget(category, budgetObj.budget_amount);
      });
    });
    
    // Update summary
    if (document.getElementById('totalBudgeted')) {
      document.getElementById('totalBudgeted').textContent = totalBudgeted.toFixed(2);
    }
    if (document.getElementById('totalSpent')) {
      document.getElementById('totalSpent').textContent = totalSpent.toFixed(2);
    }
    if (document.getElementById('totalRemaining')) {
      document.getElementById('totalRemaining').textContent = (totalBudgeted - totalSpent).toFixed(2);
    }
    
    // Show summary
    if (budgetSummary) {
      budgetSummary.style.display = 'block';
    }
    
    // Add event listeners
    document.querySelectorAll('.delete-budget').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const category = e.target.dataset.category;
        if (confirm(`Delete budget for ${category}?`)) {
          await fetch(`${API}/budgets/${encodeURIComponent(category)}`, { method: "DELETE" });
          loadBudgets();
        }
      });
    });
    
  } catch (error) {
    console.error('Error loading budgets:', error);
    
    // Show error message
    const budgetsList = document.getElementById('budgetsList');
    if (budgetsList) {
      budgetsList.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #721c24; background: #f8d7da; border-radius: 4px;">
          <p><strong>Error loading budgets</strong></p>
          <p style="font-size: 14px;">${error.message}</p>
          <button onclick="location.reload()" style="margin-top: 10px; padding: 5px 10px;">Retry</button>
        </div>
      `;
    }
    
    if (error.message.includes('authenticated') || error.message.includes('Session expired')) {
      localStorage.removeItem('finance_user');
      setTimeout(() => {
        window.location.href = '/login.html';
      }, 3000);
    }
  }
  showBudgetPeriod();
}

function showBudgetPeriod() {
  const now = new Date();

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const options = { day: 'numeric', month: 'short' };

  const text = `Budget period: ${start.toLocaleDateString(undefined, options)} – ${end.toLocaleDateString(undefined, options)}`;

  const el = document.getElementById("budgetPeriod");
  if (el) el.textContent = text;
}

// Edit budget
function startEditBudget(category, amount) {
  const formContainer = document.getElementById('budgetFormContainer');
  formContainer.style.display = 'block';

  document.getElementById('budgetEditMode').value = 'true';
  document.getElementById('budgetOriginalCategory').value = category;

  const catInput = document.getElementById('budgetCategory');
  const amountInput = document.getElementById('budgetAmount');
  catInput.value = category;
  amountInput.value = Number(amount).toFixed(2);

  catInput.disabled = true;
  catInput.classList.add('budget-category-edit');
  formContainer.classList.add('budget-form-edit');

  document.getElementById('saveBudgetBtn').textContent = 'Update';

  const addBtn = document.getElementById('addBudgetBtn');
  addBtn.textContent = 'Cancel';
  addBtn.style.background = '#6c757d';
}


// Save budget
async function saveBudget() {
  const categoryInput = document.getElementById('budgetCategory');
  const category = document.getElementById('budgetCategory').value.trim();
  const amount = document.getElementById('budgetAmount').value;
  const isEdit = document.getElementById('budgetEditMode').value === 'true';
  
  console.log('Saving budget:', { category, amount });
  
  if (!category || !amount) {
    alert('Please enter both category and amount');
    return;
  }
  
  if (amount <= 0) {
    alert('Budget amount must be greater than 0');
    return;
  }
  
  try {
    const response = await fetch(`${API}/budgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        budget_category: category,
        budget_amount: parseFloat(amount)
      })
    });
    
    const data = await response.json();
    console.log('Save response:', data);
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save budget');
    }
    
    // Hide form
    document.getElementById('budgetFormContainer').style.display = 'none';
    document.getElementById('addBudgetBtn').textContent = '+ Add Budget';
    
    // Clear form
    document.getElementById('budgetCategory').value = '';
    document.getElementById('budgetAmount').value = '';
    
    // Reload budgets
    loadBudgets();
    document.getElementById('budgetEditMode').value = 'false';
    document.getElementById('budgetOriginalCategory').value = '';

    categoryInput.disabled = false;
    categoryInput.classList.remove('budget-category-edit');
    document.getElementById('budgetFormContainer').classList.remove('budget-form-edit');

    document.getElementById('saveBudgetBtn').textContent = 'Save';


    
    alert(data.message || 'Budget saved successfully!');
    
  } catch (error) {
    console.error('Save budget error:', error);
    alert('Error: ' + error.message);
  }
}

// Toggle budget form
function toggleBudgetForm() {
  const formContainer = document.getElementById('budgetFormContainer');
  const addBtn = document.getElementById('addBudgetBtn');
  
  if (formContainer.style.display === 'none' || !formContainer.style.display) {
    formContainer.style.display = 'block';
    addBtn.textContent = 'Cancel';
    addBtn.style.background = '#6c757d';
  } else {
    formContainer.style.display = 'none';
    addBtn.textContent = '+ Add Budget';
    addBtn.style.background = '';
    document.getElementById('budgetCategory').value = '';
    document.getElementById('budgetAmount').value = '';
  }
}


// Add expense form submission
if (form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    const amount = document.getElementById("amount").value;
    const date = document.getElementById("date").value;
    const category = document.getElementById("category").value;
    const vendor = document.getElementById("vendor").value;
    const location = document.getElementById("location").value;
    const note = document.getElementById("notes").value;

    await fetch(`${API}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, date, category, vendor, location, note })
    });

    form.reset();
    loadExpenses();
    loadBudgets();
  });
}

function initializeSocket() {
  socket = io({
    path: "/socket.io/",
    withCredentials: true,
    transports: ["websocket"]
  });

  socket.on("connect", () => {
    console.log("Socket connected:", socket.id);
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected");
  });

socket.on("budget_alert", alert => {
  console.log("BUDGET ALERT RECEIVED", alert);
  showToast(alert);
  loadBudgets();
});

socket.on("fraud_alert", alert => {
  console.log("FRAUD ALERT RECEIVED", alert);
  showFraudToast(alert);
  loadBudgets();
});
}

// DOM Content Loaded - Main initialization
document.addEventListener('DOMContentLoaded', function() {
  const authCheckEl = document.getElementById('authCheck');
  const appContentEl = document.getElementById('appContent');
  
  // Check if user is logged in
  const user = localStorage.getItem('finance_user');
  
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  
  // User is logged in, show the app
  if (authCheckEl) authCheckEl.style.display = 'none';
  if (appContentEl) appContentEl.style.display = 'block';

// Connect socket FIRST
initializeSocket();

// THEN load data
loadUserProfile();
loadExpenses();
loadBudgets();
  
  // Budget button event listeners
  const addBudgetBtn = document.getElementById('addBudgetBtn');
  if (addBudgetBtn) {
    addBudgetBtn.addEventListener('click', toggleBudgetForm);
  }
  
  const saveBudgetBtn = document.getElementById('saveBudgetBtn');
  if (saveBudgetBtn) {
    saveBudgetBtn.addEventListener('click', saveBudget);
  }
  
  const cancelBudgetBtn = document.getElementById('cancelBudgetBtn');
if (cancelBudgetBtn) {
  cancelBudgetBtn.addEventListener('click', () => {
    // hide form
    document.getElementById('budgetFormContainer').style.display = 'none';

    // reset edit mode state
    document.getElementById('budgetEditMode').value = 'false';
    document.getElementById('budgetOriginalCategory').value = '';

    // reset fields
    const categoryInput = document.getElementById('budgetCategory');
    categoryInput.disabled = false;
    categoryInput.classList.remove('budget-category-edit');

    document.getElementById('budgetCategory').value = '';
    document.getElementById('budgetAmount').value = '';

    // reset form styling
    document.getElementById('budgetFormContainer').classList.remove('budget-form-edit');
    document.getElementById('saveBudgetBtn').textContent = 'Save';

    const addBtn = document.getElementById('addBudgetBtn');
    addBtn.textContent = '+ Add Budget';
    addBtn.style.background = '';
  });
}



  
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function() {
      try {
        await fetch(`${API}/logout`, { method: 'POST' });
      } catch (error) {
        console.error('Logout API error:', error);
      }
      localStorage.removeItem('finance_user');
      window.location.href = '/login.html';
    });
  }
});

// Report button
const reportBtn = document.getElementById("generateReportBtn");

if (reportBtn) {
  reportBtn.addEventListener("click", async () => {
    console.log("Report button clicked");

    const res = await fetch("/api/reports/debug-generate", {
      method: "POST"
    });

    const data = await res.json();
    console.log("Report response:", data);

    alert("Report generated!");
  });
}

// Export CSV button
function exportReportCSV(reportId) {
  window.location.href = `/api/reports/${reportId}/export/csv`;
}

// Export Latest CSV button
const exportLatestBtn = document.getElementById("exportLatestReportBtn");

if (exportLatestBtn) {
  exportLatestBtn.addEventListener("click", async () => {
    try {
      exportLatestBtn.disabled = true;

      const res = await fetch("/api/reports");
      if (!res.ok) throw new Error(`Failed to load reports (${res.status})`);

      const reports = await res.json();

      if (!Array.isArray(reports) || reports.length === 0) {
        alert("No reports found yet. Generate a report first.");
        return;
      }

      const latestReportId = reports[0]._id;
      exportReportCSV(latestReportId);
    } catch (err) {
      console.error("Export latest report failed:", err);
      alert("Could not export latest report.");
    } finally {
      exportLatestBtn.disabled = false;
    }
  });
}

// Real-time notification
function showToast(alert) {
  const toast = document.createElement("div");
  toast.className = "toast budget-toast";

  toast.innerHTML = `
    <div class="close">&times;</div>
    <strong>⚠️ Budget Alert</strong><br>
    ${alert.category}: ${alert.spent} / ${alert.limit}
  `;

  toastContainer.appendChild(toast);

  // show animation
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  // close button
  toast.querySelector(".close").onclick = () => {
    toast.remove();
  };

  // auto-dismiss after 6s
 /* setTimeout(() => {
    toast.remove();
  }, 6000);
  */
}

function showFraudToast(alert) {
  const toast = document.createElement("div");

  toast.className = "toast fraud-toast";

  toast.innerHTML = `
    <div class="close">&times;</div>
    <strong>🚨 Fraud Alert</strong><br>
    Suspicious transaction detected.<br>
    Vendor: ${alert.vendor || "Unknown"}<br>
    Amount: €${alert.amount}
  `;

  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  toast.querySelector(".close").onclick = () => {
    toast.remove();
  };
}
