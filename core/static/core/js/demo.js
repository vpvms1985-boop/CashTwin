// ==========================================
// CASHTWIN CORE CLIENT APPLICATION ENGINE
// Connected with Django Database Backend
// ==========================================

// Global state initialized from Django context (MOCK_DATA)
let currentBaseline = (typeof MOCK_DATA !== 'undefined' && MOCK_DATA)
    ? JSON.parse(JSON.stringify(MOCK_DATA))
    : null;

let invoices = (currentBaseline && Array.isArray(currentBaseline.invoices))
    ? JSON.parse(JSON.stringify(currentBaseline.invoices))
    : [];

let expenses = (currentBaseline && Array.isArray(currentBaseline.expenses))
    ? JSON.parse(JSON.stringify(currentBaseline.expenses))
    : [];

let lastCalculatedTime = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
});

let currentScreen = 'dashboard';
let simulationRun = false;
let appliedResilienceOption = null;
let pendingDeleteInvoiceId = null;
let pendingDeleteExpenseId = null;

// Initial Audit Trail
const DEFAULT_AUDIT_LOGS = [
    { time: '2026-09-01 10:00:00', entity: 'System Twin Engine', event: 'Workspace session initialized', ip: '127.0.0.1' },
    { time: '2026-09-01 10:00:05', entity: 'User', event: 'Consent granted for accounts ledger integration', ip: '127.0.0.1' }
];

let auditLogs = JSON.parse(JSON.stringify(DEFAULT_AUDIT_LOGS));

// Helper: Get CSRF token
function getCsrfToken() {
    if (typeof CSRF_TOKEN !== 'undefined' && CSRF_TOKEN) return CSRF_TOKEN;
    const cookieMatch = document.cookie.match(/csrftoken=([\w-]+)/);
    return cookieMatch ? cookieMatch[1] : '';
}

// Helper: Show Floating Toast Notification
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `p-3.5 rounded-xl text-xs font-bold shadow-xl border flex items-center space-x-2.5 transition-all duration-300 pointer-events-auto transform translate-y-2 opacity-0 ${
        type === 'success' ? 'bg-green-50 border-green-200 text-healthy' :
        type === 'error' ? 'bg-red-50 border-red-200 text-critical' :
        type === 'warning' ? 'bg-amber-50 border-attention/20 text-attention' :
        'bg-white border-border text-text-primary'
    }`;

    const icon = type === 'success'
        ? '<svg class="w-4 h-4 text-healthy shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
        : type === 'error'
        ? '<svg class="w-4 h-4 text-critical shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>'
        : '<svg class="w-4 h-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, 3500);
}

// ==========================================
// INITIALIZATION
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
    // Initial UI render
    renderInvoicesTable();
    renderExpensesTable();
    renderAuditLogs();
    initChartInteractivity();

    if (currentBaseline) {
        applyBaselineToAllScreens(currentBaseline, lastCalculatedTime);
    } else {
        recalculateEngine();
    }

    // Attach click listeners to all Add Invoice buttons
    document.querySelectorAll('[data-action="add-invoice"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openAddInvoiceModal();
        });
    });

    // Attach click listeners to all Add Expense buttons
    document.querySelectorAll('[data-action="add-expense"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openAddExpenseModal();
        });
    });

    // Check query params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('consented') === 'true') {
        addAuditEntry('User', 'Authorized scope permission connection to AR/AP ledger feeds');
    }

    // Close user dropdown if clicking outside
    document.addEventListener('click', (e) => {
        const userMenu = document.getElementById('user-profile-menu');
        const userBtn = document.getElementById('user-menu-button');
        if (userMenu && !userMenu.classList.contains('hidden')) {
            if (userBtn && !userBtn.contains(e.target) && !userMenu.contains(e.target)) {
                userMenu.classList.add('hidden');
            }
        }
    });

    // Fetch and sync live baseline from Django backend
    syncDataFromBackend();
});

function syncDataFromBackend() {
    fetch('/api/recalculate-forecast/')
        .then(res => res.json())
        .then(data => {
            if (data.success && data.baseline) {
                currentBaseline = data.baseline;
                lastCalculatedTime = data.calculated_at || lastCalculatedTime;
                if (Array.isArray(data.baseline.invoices)) invoices = data.baseline.invoices;
                if (Array.isArray(data.baseline.expenses)) expenses = data.baseline.expenses;
                renderInvoicesTable();
                renderExpensesTable();
                applyBaselineToAllScreens(currentBaseline, lastCalculatedTime);
            }
        })
        .catch(err => console.log('Initial sync fallback active', err));
}

// ==========================================
// SCREEN SWITCHING ROUTER
// ==========================================

function switchScreen(screenId) {
    const oldScreenEl = document.getElementById(`screen-${currentScreen}`);
    if (oldScreenEl) oldScreenEl.classList.add('hidden');

    const oldNav = document.getElementById(`nav-${currentScreen}`);
    if (oldNav) {
        oldNav.classList.remove('bg-primary', 'text-white');
        oldNav.classList.add('text-text-primary', 'hover:bg-[#FFFDF9]');
    }

    const newScreenEl = document.getElementById(`screen-${screenId}`);
    if (newScreenEl) newScreenEl.classList.remove('hidden');

    const newNav = document.getElementById(`nav-${screenId}`);
    if (newNav) {
        newNav.classList.add('bg-primary', 'text-white');
        newNav.classList.remove('text-text-primary', 'hover:bg-[#FFFDF9]');
    }

    currentScreen = screenId;

    const screenTitles = {
        dashboard: 'Dashboard Overview',
        digitaltwin: 'Digital Twin Model Configuration',
        cashflow: 'Cash Flow Forecast Timeline',
        riskcenter: 'Risk Intelligence Center',
        simulator: 'What-If Cash Simulator',
        resilience: 'Resilience Decision Options',
        invoices: 'Accounts Receivable Invoices',
        expenses: 'Accounts Payable Expenses',
        datareview: 'Data Review & Pipeline Integrity',
        consent: 'Feeds Consent & Privacy Manager',
        auditlog: 'Audit Log Trail'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.innerText = screenTitles[screenId] || 'Portal';

    updatePlaybookHighlight(screenId);
}

function updatePlaybookHighlight(screenId) {
    for (let i = 1; i <= 5; i++) {
        const stepDiv = document.getElementById(`play-step-${i}`);
        if (stepDiv) {
            stepDiv.classList.remove('border-primary/20', 'bg-primary/5', 'text-text-primary');
            stepDiv.classList.add('border-border', 'text-text-secondary');
        }
    }

    let activeStepNum = 1;
    if (screenId === 'riskcenter') activeStepNum = 2;
    else if (screenId === 'simulator') activeStepNum = 3;
    else if (screenId === 'resilience') activeStepNum = 4;
    else if (screenId === 'datareview') activeStepNum = 5;

    const activeStep = document.getElementById(`play-step-${activeStepNum}`);
    if (activeStep) {
        activeStep.classList.remove('border-border', 'text-text-secondary');
        activeStep.classList.add('border-primary/20', 'bg-primary/5', 'text-text-primary');
    }
}

// ==========================================
// DATE & FORMATTING UTILITIES
// ==========================================

function calculateDelayDays(dueDateStr, expectedDateStr) {
    if (!dueDateStr || !expectedDateStr) return null;
    const d1 = new Date(dueDateStr);
    const d2 = new Date(expectedDateStr);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
    const diffTime = d2.getTime() - d1.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function formatDateString(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatPrettyDate(dateStr) {
    if (!dateStr || dateStr === 'No Deficit') return 'No Deficit';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const day = d.getDate();
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return `${day} ${months[d.getMonth()]}`;
    } catch (e) {
        return dateStr;
    }
}

// ==========================================
// CLIENT DETERMINISTIC CALCULATION FALLBACK
// Matches Django backend logic 100%
// ==========================================

function calculateForecast(invoicesList, expensesList, scenarioModifiers = null) {
    const liveCurrentCash = 520000;
    const safeThreshold = 150000;

    const activeInvoices = invoicesList.filter(inv => ['Pending', 'Overdue', 'Verified', 'Needs Review'].includes(inv.status));
    const activeExpenses = expensesList.filter(exp => ['Upcoming', 'Pending'].includes(exp.status));

    const missingDateInvoices = activeInvoices.filter(inv => !inv.expected_date);
    const dataQuality = missingDateInvoices.length === 0 ? 100 : Math.max(60, 100 - (missingDateInvoices.length * 4));

    const timelineEvents = [];
    let totalReceivables = 0;
    let totalExpenses = 0;

    // Process Expenses
    activeExpenses.forEach(exp => {
        const amount = Number(exp.amount) || 0;
        totalExpenses += amount;
        timelineEvents.push({
            date: exp.due_date,
            type: 'expense',
            amount: amount,
            desc: exp.payee
        });
    });

    if (scenarioModifiers && Number(scenarioModifiers.unexpectedExpenses) > 0) {
        const unexpAmt = Number(scenarioModifiers.unexpectedExpenses);
        totalExpenses += unexpAmt;
        timelineEvents.push({
            date: '2026-09-07',
            type: 'expense',
            amount: unexpAmt,
            desc: 'Unexpected Contingency Outflow'
        });
    }

    // Process Invoices
    const customerTotals = {};
    const customerDelays = {};

    activeInvoices.forEach(inv => {
        let amount = Number(inv.amount) || 0;

        if (scenarioModifiers && scenarioModifiers.salesVolumePct) {
            const factor = 1 + (Number(scenarioModifiers.salesVolumePct) / 100);
            amount = Math.round(amount * factor);
        }

        totalReceivables += amount;

        const cust = inv.customer || 'Unknown';
        customerTotals[cust] = (customerTotals[cust] || 0) + amount;

        let arrivalDateStr = inv.expected_date || inv.due_date || '2026-09-15';

        if (scenarioModifiers && scenarioModifiers.extraDelayDays > 0) {
            const isTarget = (!scenarioModifiers.targetCustomer || cust.toLowerCase().includes(scenarioModifiers.targetCustomer.toLowerCase()));
            if (isTarget) {
                const baseDate = new Date(arrivalDateStr);
                if (!isNaN(baseDate.getTime())) {
                    baseDate.setDate(baseDate.getDate() + Number(scenarioModifiers.extraDelayDays));
                    arrivalDateStr = formatDateString(baseDate);
                }
            }
        }

        timelineEvents.push({
            date: arrivalDateStr,
            type: 'receivable',
            amount: amount,
            desc: `${cust} (${inv.id})`
        });
    });

    invoicesList.forEach(inv => {
        const cust = inv.customer || 'Unknown';
        if (!customerDelays[cust]) customerDelays[cust] = { total_delay: 0, count: 0, avg_delay: 0 };
        if (inv.delay_days !== null && inv.delay_days !== undefined && inv.delay_days !== '') {
            customerDelays[cust].total_delay += Number(inv.delay_days);
            customerDelays[cust].count += 1;
        }
    });

    Object.keys(customerDelays).forEach(cust => {
        if (customerDelays[cust].count > 0) {
            customerDelays[cust].avg_delay = Math.round(customerDelays[cust].total_delay / customerDelays[cust].count);
        }
    });

    let topCustomer = 'None';
    let topCustomerAmount = 0;
    Object.keys(customerTotals).forEach(cust => {
        if (customerTotals[cust] > topCustomerAmount) {
            topCustomerAmount = customerTotals[cust];
            topCustomer = cust;
        }
    });

    const topConcentrationPct = totalReceivables > 0 ? Math.round((topCustomerAmount / totalReceivables) * 100) : 0;
    const topConcentrationRisk = topConcentrationPct >= 50 ? 'HIGH' : (topConcentrationPct >= 25 ? 'MEDIUM' : 'LOW');

    let topDelayedInvoice = activeInvoices.find(i => i.id === 'INV-2026-001') || activeInvoices[0] || null;
    let maxDelay = -999;
    activeInvoices.forEach(inv => {
        if (inv.delay_days !== null && inv.delay_days !== undefined && Number(inv.delay_days) > maxDelay) {
            maxDelay = Number(inv.delay_days);
            topDelayedInvoice = inv;
        }
    });

    timelineEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    let runningCash = liveCurrentCash;
    let minCash = liveCurrentCash;
    let minCashDate = timelineEvents.length > 0 ? timelineEvents[0].date : '2026-09-18';

    timelineEvents.forEach(evt => {
        if (evt.type === 'expense') {
            runningCash -= evt.amount;
        } else if (evt.type === 'receivable') {
            runningCash += evt.amount;
        }
        if (runningCash < minCash) {
            minCash = runningCash;
            minCashDate = evt.date;
        }
    });

    let liquidityGap = 0;
    let hasLiquidityGap = false;
    let forecastStatus = 'HEALTHY';
    let forecastStatusDisplay = 'Healthy / Safe Liquidity';

    if (minCash < safeThreshold) {
        liquidityGap = safeThreshold - minCash;
        hasLiquidityGap = true;
        forecastStatus = liquidityGap >= 300000 ? 'CRITICAL_DEFICIT' : 'DEFICIT_RISK';
        forecastStatusDisplay = liquidityGap >= 300000 ? 'Critical Deficit Risk' : 'Projected Liquidity Gap';
    }

    return {
        current_cash: liveCurrentCash,
        safe_threshold: safeThreshold,
        total_receivables: totalReceivables,
        pending_invoice_count: activeInvoices.length,
        total_expenses: totalExpenses,
        upcoming_expense_count: activeExpenses.length,
        projected_min_cash: minCash,
        min_cash_date: minCashDate,
        pretty_min_cash_date: formatPrettyDate(minCashDate),
        liquidity_gap: liquidityGap,
        has_liquidity_gap: hasLiquidityGap,
        gap_date: hasLiquidityGap ? minCashDate : null,
        pretty_gap_date: hasLiquidityGap ? formatPrettyDate(minCashDate) : 'No Deficit',
        forecast_status: forecastStatus,
        forecast_status_display: forecastStatusDisplay,
        top_customer: topCustomer,
        top_customer_amount: topCustomerAmount,
        top_concentration_pct: topConcentrationPct,
        top_concentration_risk: topConcentrationRisk,
        customer_delays: customerDelays,
        top_delayed_invoice: topDelayedInvoice,
        missing_date_invoices: missingDateInvoices,
        data_quality: dataQuality
    };
}

// ==========================================
// UNIFIED BASELINE SYNCHRONIZATION ENGINE
// Updates all screens with the single baseline
// ==========================================

function applyBaselineToAllScreens(baseline, calculatedAtTime = null) {
    if (!baseline) return;
    currentBaseline = baseline;
    if (calculatedAtTime) lastCalculatedTime = calculatedAtTime;

    const minCash = Number(baseline.projected_min_cash ?? baseline.projectedMinCash ?? 0);
    const gapVal = Number(baseline.liquidity_gap ?? baseline.liquidityGap ?? 0);
    const hasGap = baseline.has_liquidity_gap !== undefined ? Boolean(baseline.has_liquidity_gap) : gapVal > 0;
    const safeThresh = Number(baseline.safe_threshold ?? baseline.safeThreshold ?? 150000);
    const totalAR = Number(baseline.total_receivables ?? baseline.totalReceivables ?? 0);
    const countAR = Number(baseline.pending_invoice_count ?? baseline.pendingInvoiceCount ?? 0);
    const totalAP = Number(baseline.total_expenses ?? baseline.totalExpenses ?? 0);
    const currentCash = Number(baseline.current_cash ?? baseline.currentCash ?? 0);
    const prettyDate = baseline.pretty_min_cash_date || baseline.prettyMinCashDate || formatPrettyDate(baseline.min_cash_date || baseline.minCashDate);
    const dataQuality = Number(baseline.data_quality ?? baseline.dataQuality ?? 100);
    const missingList = baseline.missing_date_invoices || baseline.missingDateInvoices || [];
    const hasData = Boolean(baseline.has_data !== false && (totalAR > 0 || totalAP > 0 || currentCash > 0 || countAR > 0));

    // 0. EMPTY STATE TOGGLE
    const dashEmpty = document.getElementById('dashboard-empty-state');
    const dashPop = document.getElementById('dashboard-populated-content');
    if (dashEmpty && dashPop) {
        if (hasData) {
            dashEmpty.classList.add('hidden');
            dashPop.classList.remove('hidden');
        } else {
            dashEmpty.classList.remove('hidden');
            dashPop.classList.add('hidden');
        }
    }

    const headerLiveBal = document.getElementById('header-live-balance');
    if (headerLiveBal) {
        headerLiveBal.innerText = `₹${currentCash.toLocaleString('en-IN')}`;
    }

    // 1. HEADER STATUS BADGES
    const headerQualityBadge = document.getElementById('header-quality-badge');
    if (headerQualityBadge) {
        headerQualityBadge.innerText = `${dataQuality}%`;
        headerQualityBadge.className = dataQuality >= 100 ? 'text-healthy font-bold' : 'text-attention font-bold';
    }

    const invoicesReviewBadge = document.getElementById('invoices-review-badge');
    if (invoicesReviewBadge) {
        if (missingList.length > 0) {
            invoicesReviewBadge.innerText = `⚠️ ${missingList.length} Invoices Require Review`;
            invoicesReviewBadge.className = 'text-xs font-semibold text-primary bg-orange-50 border border-primary/20 px-3 py-1.5 rounded-lg';
            invoicesReviewBadge.classList.remove('hidden');
        } else {
            invoicesReviewBadge.innerText = '✓ All Invoices Verified';
            invoicesReviewBadge.className = 'text-xs font-semibold text-healthy bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg';
        }
    }

    // 2. DATA REVIEW SCREEN CALCULATION RESULT PANEL
    const drTime = document.getElementById('datareview-calc-time');
    if (drTime) drTime.innerText = `Last calculated: ${lastCalculatedTime}`;

    const drTitle = document.getElementById('datareview-calc-title');
    const drDot = document.getElementById('datareview-calc-dot');
    if (drTitle) {
        drTitle.innerText = hasGap ? '✓ Forecast Recalculated (Liquidity Gap Identified)' : '✓ Forecast Recalculated (Safe Liquidity Position)';
        drTitle.className = hasGap ? 'text-xs font-extrabold text-red-950 tracking-wide uppercase' : 'text-xs font-extrabold text-green-950 tracking-wide uppercase';
    }
    if (drDot) {
        drDot.className = hasGap ? 'w-2.5 h-2.5 rounded-full bg-critical animate-pulse' : 'w-2.5 h-2.5 rounded-full bg-healthy animate-pulse';
    }

    const drMinCash = document.getElementById('datareview-min-cash');
    if (drMinCash) {
        drMinCash.innerText = `₹${minCash.toLocaleString('en-IN')}`;
        drMinCash.className = hasGap ? 'text-base font-black text-critical' : 'text-base font-black text-healthy';
    }

    const drGapVal = document.getElementById('datareview-gap-val');
    if (drGapVal) {
        drGapVal.innerText = hasGap ? `₹${gapVal.toLocaleString('en-IN')}` : '₹0 (No Deficit)';
        drGapVal.className = hasGap ? 'text-base font-black text-critical' : 'text-base font-black text-healthy';
    }

    const drGapDate = document.getElementById('datareview-gap-date');
    if (drGapDate) drGapDate.innerText = hasGap ? prettyDate : 'None (Safe)';

    const drSafeThresh = document.getElementById('datareview-safe-threshold');
    if (drSafeThresh) drSafeThresh.innerText = `₹${safeThresh.toLocaleString('en-IN')}`;

    const drStatusBadge = document.getElementById('datareview-status-badge');
    if (drStatusBadge) {
        if (hasGap) {
            drStatusBadge.innerText = gapVal >= 300000 ? 'Critical Deficit' : 'Deficit Risk';
            drStatusBadge.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase bg-red-50 text-critical border border-red-200';
        } else {
            drStatusBadge.innerText = 'Safe / Healthy';
            drStatusBadge.className = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase bg-green-50 text-healthy border border-green-200';
        }
    }

    const dataReviewScoreBadge = document.getElementById('datareview-score-badge');
    if (dataReviewScoreBadge) {
        dataReviewScoreBadge.innerText = `Data Quality: ${dataQuality}%`;
        dataReviewScoreBadge.className = dataQuality >= 100
            ? 'px-3 py-1.5 bg-green-50 text-healthy border border-green-200 rounded-lg text-xs font-bold shadow-2xs'
            : 'px-3 py-1.5 bg-amber-50 text-attention border border-attention/20 rounded-lg text-xs font-bold shadow-2xs';
    }

    const checkMissingRow = document.getElementById('check-missing-dates-row');
    const checkMissingText = document.getElementById('check-missing-dates-text');
    const checkMissingBadge = document.getElementById('check-missing-dates-badge');

    if (checkMissingRow && checkMissingText && checkMissingBadge) {
        if (missingList.length === 0) {
            checkMissingRow.className = 'flex items-center justify-between text-healthy';
            checkMissingText.innerText = '✓ All invoices have verified expected payment dates';
            checkMissingBadge.className = 'text-[10px] bg-green-50 px-1.5 py-0.5 rounded font-bold text-healthy';
            checkMissingBadge.innerText = 'Passed';
        } else {
            checkMissingRow.className = 'flex items-center justify-between text-attention';
            checkMissingText.innerText = `⚠️ ${missingList.length} invoice${missingList.length > 1 ? 's have' : ' has'} missing expected payment dates`;
            checkMissingBadge.className = 'text-[10px] bg-amber-50 px-1.5 py-0.5 rounded font-bold text-attention';
            checkMissingBadge.innerText = 'Action Required';
        }
    }

    renderDataReviewList(missingList);

    // 3. DASHBOARD SCREEN
    const dashCurrentCash = document.getElementById('dashboard-current-cash');
    if (dashCurrentCash) dashCurrentCash.innerText = `₹${currentCash.toLocaleString('en-IN')}`;

    const dashReceivablesVal = document.getElementById('dashboard-receivables-val');
    if (dashReceivablesVal) dashReceivablesVal.innerText = `₹${totalAR.toLocaleString('en-IN')}`;

    const dashReceivablesCount = document.getElementById('dashboard-receivables-count');
    if (dashReceivablesCount) dashReceivablesCount.innerText = `Across ${countAR} pending customer invoices`;

    const dashExpensesVal = document.getElementById('dashboard-expenses-val');
    if (dashExpensesVal) dashExpensesVal.innerText = `₹${totalAP.toLocaleString('en-IN')}`;

    const dashMinCash = document.getElementById('dashboard-min-cash');
    if (dashMinCash) {
        dashMinCash.innerText = `₹${minCash.toLocaleString('en-IN')}`;
        dashMinCash.className = hasGap ? 'text-2xl font-black text-critical mt-1' : 'text-2xl font-black text-healthy mt-1';
    }

    // Dashboard Alert Banner
    const dashAlert = document.getElementById('dashboard-alert');
    const dashAlertIcon = document.getElementById('dashboard-alert-icon');
    const dashAlertTitle = document.getElementById('dashboard-alert-title');
    const dashAlertDesc = document.getElementById('dashboard-alert-desc');
    const dashAlertActions = document.getElementById('dashboard-alert-actions');

    if (dashAlert) {
        if (hasGap) {
            dashAlert.className = 'p-4 bg-red-50 border-2 border-red-100 rounded-xl flex items-start space-x-4';
            if (dashAlertIcon) {
                dashAlertIcon.className = 'p-2 bg-red-100 text-critical rounded-lg';
                dashAlertIcon.innerHTML = `
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                `;
            }
            if (dashAlertTitle) {
                dashAlertTitle.innerText = 'Projected Liquidity Gap Identified';
                dashAlertTitle.className = 'text-sm font-extrabold text-red-950';
            }
            if (dashAlertDesc) {
                dashAlertDesc.className = 'text-xs text-red-700 leading-relaxed';
                dashAlertDesc.innerHTML = `
                    Your cash balance is projected to fall to <span class="font-bold">₹${minCash.toLocaleString('en-IN')}</span> (below your safety threshold of ₹1,50,000) around <span class="font-bold">${prettyDate}</span>. A potential liquidity gap of <span class="font-bold">₹${gapVal.toLocaleString('en-IN')}</span> is expected.
                `;
            }
            if (dashAlertActions) dashAlertActions.className = 'pt-2 flex items-center space-x-3';
        } else {
            dashAlert.className = 'p-4 bg-green-50 border-2 border-green-100 rounded-xl flex items-start space-x-4';
            if (dashAlertIcon) {
                dashAlertIcon.className = 'p-2 bg-green-100 text-healthy rounded-lg';
                dashAlertIcon.innerHTML = `
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                `;
            }
            if (dashAlertTitle) {
                dashAlertTitle.innerText = '✓ Healthy Projected Cash Position';
                dashAlertTitle.className = 'text-sm font-extrabold text-green-950';
            }
            if (dashAlertDesc) {
                dashAlertDesc.className = 'text-xs text-green-700 leading-relaxed';
                dashAlertDesc.innerHTML = `
                    Your projected cash balance remains above the safety threshold of ₹1,50,000 across all forward periods (Projected minimum: <span class="font-bold">₹${minCash.toLocaleString('en-IN')}</span>). No liquidity gap identified.
                `;
            }
            if (dashAlertActions) dashAlertActions.className = 'hidden';
        }
    }

    // AI Insight Widget
    const topCustomer = baseline.top_customer || baseline.topCustomer || 'None';
    const aiInsightText = document.getElementById('ai-insight-text');
    if (aiInsightText) {
        aiInsightText.innerText = hasGap
            ? `"Your cash position may fall below the safe threshold around ${prettyDate}."`
            : (hasData ? `"Your forward liquidity trajectory is healthy with sufficient cash buffer."` : `"Add financial records to activate intelligence insights."`);
    }
    const aiInsightCause = document.getElementById('ai-insight-cause');
    if (aiInsightCause) {
        aiInsightCause.innerText = hasGap
            ? `Concentration delay: ${topCustomer} invoice arrival timing impacts the monthly buffer.`
            : (hasData ? `All receivables and payable schedules are well distributed across the projection period.` : `Dynamic forecast generated from recorded receivables and payables.`);
    }

    // Traceability Inflow / Net
    const traceInflowVal = document.getElementById('trace-inflow-val');
    if (traceInflowVal) traceInflowVal.innerText = `₹${totalAR.toLocaleString('en-IN')} (Receivables)`;

    const traceNetVal = document.getElementById('trace-net-val');
    const traceNetDot = document.getElementById('trace-net-dot');
    if (traceNetVal) {
        if (hasGap) {
            traceNetVal.innerText = `₹${gapVal.toLocaleString('en-IN')} Gap on ${prettyDate.replace(' ', '-')}`;
            traceNetVal.className = 'text-[10px] text-critical font-bold';
            if (traceNetDot) traceNetDot.className = 'w-3 h-3 rounded-full bg-critical border-2 border-white ring-2 ring-critical';
        } else {
            traceNetVal.innerText = `Safe Surplus (Min: ₹${minCash.toLocaleString('en-IN')})`;
            traceNetVal.className = 'text-[10px] text-healthy font-bold';
            if (traceNetDot) traceNetDot.className = 'w-3 h-3 rounded-full bg-healthy border-2 border-white ring-2 ring-healthy';
        }
    }

    // 4. DIGITAL TWIN SCREEN
    const twinReceivablesVal = document.getElementById('twin-receivables-val');
    if (twinReceivablesVal) twinReceivablesVal.innerText = `₹${totalAR.toLocaleString('en-IN')}`;

    const twinMinCash = document.getElementById('twin-min-cash');
    if (twinMinCash) {
        twinMinCash.innerText = `₹${minCash.toLocaleString('en-IN')}`;
        twinMinCash.className = hasGap ? 'text-sm font-bold text-critical' : 'text-sm font-bold text-healthy';
    }

    const twinGapVal = document.getElementById('twin-gap-val');
    if (twinGapVal) {
        twinGapVal.innerText = `₹${gapVal.toLocaleString('en-IN')}`;
        twinGapVal.className = hasGap ? 'text-sm font-bold text-critical' : 'text-sm font-bold text-healthy';
    }

    const twinGapDate = document.getElementById('twin-gap-date');
    if (twinGapDate) {
        twinGapDate.innerText = hasGap ? prettyDate : 'No Deficit';
        twinGapDate.className = hasGap ? 'text-sm font-bold text-critical' : 'text-sm font-bold text-healthy';
    }

    const twinRiskBadge = document.getElementById('twin-risk-badge');
    if (twinRiskBadge) {
        twinRiskBadge.innerText = hasGap ? 'Risk State' : 'Optimal State';
        twinRiskBadge.className = hasGap
            ? 'text-[10px] font-bold text-critical bg-red-50 px-2 py-0.5 rounded'
            : 'text-[10px] font-bold text-healthy bg-green-50 px-2 py-0.5 rounded';
    }

    const twinCalcRiskBox = document.getElementById('twin-calc-risk-box');
    if (twinCalcRiskBox) {
        twinCalcRiskBox.innerText = hasGap ? 'Calculated Risk: High Potential Gap' : 'Calculated Risk: Safe Liquidity Profile';
        twinCalcRiskBox.className = hasGap
            ? 'p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-critical font-bold text-center'
            : 'p-3 bg-green-50 border border-green-100 rounded-lg text-xs text-healthy font-bold text-center';
    }

    // 5. CASH FLOW SVG CHART
    updateSvgChart(minCash, prettyDate);

    // 6. RISK CENTER SCREEN
    const riskStatusTag = document.getElementById('risk-status-tag');
    if (riskStatusTag) {
        riskStatusTag.innerText = hasGap ? 'Projected Liquidity Deficit Risk' : 'Projected Liquidity Position Safe';
        riskStatusTag.className = hasGap
            ? 'text-xs font-bold text-critical uppercase bg-red-50 px-2.5 py-1 rounded'
            : 'text-xs font-bold text-healthy uppercase bg-green-50 px-2.5 py-1 rounded';
    }

    const riskImpactVal = document.getElementById('risk-impact-val');
    if (riskImpactVal) riskImpactVal.innerText = `Expected Impact: ₹${gapVal.toLocaleString('en-IN')}`;

    const riskStage1Gap = document.getElementById('risk-stage1-gap');
    if (riskStage1Gap) riskStage1Gap.innerText = `Gap of ₹${gapVal.toLocaleString('en-IN')}`;

    const riskStage1Desc = document.getElementById('risk-stage1-desc');
    if (riskStage1Desc) {
        riskStage1Desc.innerText = hasGap
            ? `Projected cash position falls to ₹${minCash.toLocaleString('en-IN')}, violating safety limit on ${prettyDate}.`
            : `Projected minimum cash position is ₹${minCash.toLocaleString('en-IN')}, remaining comfortably above safety limit.`;
    }

    const customerDelays = baseline.customer_delays || baseline.customerDelays || {};
    const topCustDelay = (customerDelays[topCustomer] && customerDelays[topCustomer].count > 0)
        ? (customerDelays[topCustomer].avg_delay ?? customerDelays[topCustomer].avgDelay ?? 15)
        : 15;

    const riskStage2Desc = document.getElementById('risk-stage2-desc');
    if (riskStage2Desc) {
        riskStage2Desc.innerText = `${topCustomer} payment timeline expected at ${topCustDelay} days average delay past terms.`;
    }

    const topDelayedInv = baseline.top_delayed_invoice || baseline.topDelayedInvoice;
    const riskStage3Id = document.getElementById('risk-stage3-id');
    const riskStage3Desc = document.getElementById('risk-stage3-desc');
    if (topDelayedInv && riskStage3Id && riskStage3Desc) {
        riskStage3Id.innerText = topDelayedInv.id;
        riskStage3Desc.innerText = `Amount ₹${Number(topDelayedInv.amount).toLocaleString('en-IN')} due ${topDelayedInv.due_date}. Collection timeline mapped to cash flow twin.`;
    }

    // Concentration
    const topConcPct = Number(baseline.top_concentration_pct ?? baseline.topConcentrationPct ?? 0);
    const topConcRisk = baseline.top_concentration_risk || baseline.topConcentrationRisk || 'MEDIUM';

    const riskConcLabel = document.getElementById('risk-conc-label');
    if (riskConcLabel) riskConcLabel.innerText = `${topCustomer} share:`;

    const riskConcVal = document.getElementById('risk-conc-val');
    if (riskConcVal) {
        riskConcVal.innerText = `${topConcPct}% of total AR (${topConcRisk})`;
        riskConcVal.className = topConcRisk === 'HIGH' ? 'font-bold text-critical' : (topConcRisk === 'MEDIUM' ? 'font-bold text-attention' : 'font-bold text-healthy');
    }

    const riskConcBar = document.getElementById('risk-conc-bar');
    if (riskConcBar) {
        riskConcBar.style.width = `${Math.min(100, Math.max(5, topConcPct))}%`;
        riskConcBar.className = topConcRisk === 'HIGH' ? 'bg-critical h-2 rounded-full' : (topConcRisk === 'MEDIUM' ? 'bg-attention h-2 rounded-full' : 'bg-healthy h-2 rounded-full');
    }

    const riskProfilesContainer = document.getElementById('risk-customer-profiles');
    if (riskProfilesContainer) {
        riskProfilesContainer.innerHTML = '';
        const customers = Object.keys(customerDelays);
        if (customers.length === 0) {
            riskProfilesContainer.innerHTML = '<p class="text-text-secondary text-[11px]">No customer profiles recorded.</p>';
        } else {
            customers.forEach(cust => {
                const data = customerDelays[cust];
                const avg = data.avg_delay ?? data.avgDelay ?? (data.count > 0 ? Math.round(data.total_delay / data.count) : 0);
                let badgeClass = 'text-healthy';
                let rating = 'LOW';
                if (avg >= 14) { badgeClass = 'text-critical'; rating = 'HIGH'; }
                else if (avg >= 7) { badgeClass = 'text-attention'; rating = 'MEDIUM'; }

                const row = `
                    <div class="flex justify-between items-center py-0.5">
                        <span class="text-text-secondary">${cust} Delay:</span>
                        <span class="font-bold ${badgeClass}">${avg} Days avg delay (${rating})</span>
                    </div>
                `;
                riskProfilesContainer.innerHTML += row;
            });
        }
    }

    // 7. FORECAST CONFIDENCE & CUSTOMER RISK TABLE
    updateForecastConfidenceUI(baseline);
    renderCustomerRiskTable();

    // 8. WHAT-IF SIMULATOR BASELINE
    const simBaseMin = document.getElementById('sim-baseline-min');
    if (simBaseMin) simBaseMin.innerText = `₹${minCash.toLocaleString('en-IN')}`;

    const simBaseGap = document.getElementById('sim-baseline-gap');
    if (simBaseGap) simBaseGap.innerText = hasGap ? `₹${gapVal.toLocaleString('en-IN')}` : '₹0 (Safe)';

    const simBaseDate = document.getElementById('sim-baseline-date');
    if (simBaseDate) simBaseDate.innerText = prettyDate;

    const simBaseStatus = document.getElementById('sim-baseline-status');
    if (simBaseStatus) {
        simBaseStatus.innerText = hasGap ? (gapVal >= 300000 ? 'Critical Deficit' : 'Deficit Risk') : 'Safe / Healthy';
        simBaseStatus.className = hasGap ? 'text-[10px] font-bold text-critical' : 'text-[10px] font-bold text-healthy';
    }

    const simBarBase = document.getElementById('sim-bar-baseline');
    const simBarBaseLabel = document.getElementById('sim-bar-baseline-label');
    if (simBarBase) {
        const heightPx = Math.min(80, Math.max(15, Math.round((minCash / 520000) * 80)));
        simBarBase.style.height = `${heightPx}px`;
    }
    if (simBarBaseLabel) {
        simBarBaseLabel.innerText = `Baseline Min: ₹${(minCash / 100000).toFixed(1)}L`;
    }

    // Re-evaluate current What-If simulation against this updated baseline
    runSimulation(false);
}

function recalculateEngine() {
    const baseline = calculateForecast(invoices, expenses, null);
    applyBaselineToAllScreens(baseline, lastCalculatedTime);
}

// ==========================================
// RECALCULATE FORECAST BACKEND ACTION
// Real API endpoint call to Django
// ==========================================

function triggerForecastRecalculation() {
    const btn = document.getElementById('btn-recalculate-forecast');
    const btnText = document.getElementById('recalc-btn-text');
    const btnIcon = document.getElementById('recalc-btn-icon');

    if (btn) btn.disabled = true;
    if (btnText) btnText.innerText = 'Recalculating...';
    if (btnIcon) btnIcon.classList.add('animate-spin');

    fetch('/api/recalculate-forecast/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({})
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
    })
    .then(data => {
        if (btn) btn.disabled = false;
        if (btnText) btnText.innerText = 'Recalculate Forecast';
        if (btnIcon) btnIcon.classList.remove('animate-spin');

        if (data.success && data.baseline) {
            currentBaseline = data.baseline;
            lastCalculatedTime = data.calculated_at || new Date().toLocaleString('en-IN');
            if (Array.isArray(data.baseline.invoices)) invoices = data.baseline.invoices;
            if (Array.isArray(data.baseline.expenses)) expenses = data.baseline.expenses;

            renderInvoicesTable();
            renderExpensesTable();
            applyBaselineToAllScreens(data.baseline, data.calculated_at);

            addAuditEntry('System Twin Engine', `User manual trigger: Recalculated central liquidity twin across all models (Min Cash: ₹${data.baseline.projected_min_cash.toLocaleString('en-IN')})`);
            showToast(`✓ Forecast recalculated successfully. Min Cash: ₹${data.baseline.projected_min_cash.toLocaleString('en-IN')}, Gap: ₹${data.baseline.liquidity_gap.toLocaleString('en-IN')}`, 'success');
        } else {
            showToast(data.error || 'Failed to recalculate forecast.', 'error');
        }
    })
    .catch(err => {
        console.error('Recalculation error:', err);
        if (btn) btn.disabled = false;
        if (btnText) btnText.innerText = 'Recalculate Forecast';
        if (btnIcon) btnIcon.classList.remove('animate-spin');

        // Fallback local deterministic engine
        recalculateEngine();
        showToast('✓ Forecast recalculated using local cash ledger twin.', 'success');
    });
}

// ==========================================
// DATA REVIEW USER CORRECTION WORKFLOW
// ==========================================

function renderDataReviewList(missingInvoices) {
    const pendingCount = document.getElementById('datareview-pending-count');
    const pendingList = document.getElementById('datareview-pending-list');
    const correctionNeededPanel = document.getElementById('correction-needed-panel');
    const correctionSuccessPanel = document.getElementById('correction-success-panel');

    if (!pendingList || !correctionNeededPanel || !correctionSuccessPanel) return;

    if (!missingInvoices || missingInvoices.length === 0) {
        correctionNeededPanel.classList.add('hidden');
        correctionSuccessPanel.classList.remove('hidden');
    } else {
        correctionNeededPanel.classList.remove('hidden');
        correctionSuccessPanel.classList.add('hidden');
        if (pendingCount) pendingCount.innerText = `${missingInvoices.length} Pending Verification`;

        pendingList.innerHTML = '';
        missingInvoices.forEach(inv => {
            const defaultDate = inv.due_date || '2026-09-15';
            const item = `
                <div class="p-3 bg-white border border-amber-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
                    <div>
                        <div class="flex items-center space-x-2">
                            <span class="font-mono font-bold text-primary">${inv.id}</span>
                            <span class="font-semibold text-text-primary">${inv.customer}</span>
                            <span class="text-text-secondary">• ₹${Number(inv.amount).toLocaleString('en-IN')}</span>
                            <span class="text-[10px] font-bold text-attention bg-amber-50 px-2 py-0.5 rounded border border-amber-200">Needs Review</span>
                        </div>
                        <p class="text-[11px] text-text-secondary mt-1">
                            Due Date: <span class="font-mono font-semibold text-text-primary">${inv.due_date || '-'}</span> 
                            • <span class="text-text-secondary">Enter expected arrival date and save to update database</span>
                        </p>
                    </div>
                    <div class="flex items-center space-x-2 shrink-0">
                        <div class="flex flex-col">
                            <label for="direct-date-${inv.id}" class="sr-only">Expected Date</label>
                            <input type="date" id="direct-date-${inv.id}" value="${defaultDate}"
                                class="px-2.5 py-1.5 border border-border rounded-lg bg-background text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40">
                        </div>
                        <button type="button" onclick="saveDirectInvoiceCorrection('${inv.id}')"
                            class="px-3 py-1.5 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer whitespace-nowrap active:scale-95">
                            Save Date
                        </button>
                        <button type="button" onclick="openDataReviewEditModal('${inv.id}')"
                            class="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-text-primary font-bold text-xs rounded-lg transition-all cursor-pointer"
                            title="Edit Full Record">
                            ✏️ Edit
                        </button>
                    </div>
                </div>
            `;
            pendingList.innerHTML += item;
        });
    }
}

function saveDirectInvoiceCorrection(invId) {
    const inputEl = document.getElementById(`direct-date-${invId}`);
    const expectedDate = inputEl ? inputEl.value : null;

    if (!expectedDate) {
        showToast('Please select a valid expected payment date.', 'error');
        return;
    }

    fetch(`/api/invoices/${encodeURIComponent(invId)}/correction/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ expected_date: expectedDate })
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
    })
    .then(data => {
        if (data.success) {
            // Update local invoice state
            const idx = invoices.findIndex(i => i.id === invId);
            if (idx !== -1) {
                invoices[idx].expected_date = expectedDate;
                invoices[idx].status = 'Verified';
                invoices[idx].delay_days = calculateDelayDays(invoices[idx].due_date, expectedDate);
            }

            if (data.baseline) {
                applyBaselineToAllScreens(data.baseline, data.calculated_at);
            } else {
                recalculateEngine();
            }

            renderInvoicesTable();
            addAuditEntry('User', `Saved date correction for ${invId}: set expected payment date to ${expectedDate} (Status: Verified)`);
            showToast(`✓ Correction saved & forecast updated for ${invId} (${expectedDate})`, 'success');
        } else {
            showToast(data.error || 'Failed to save correction.', 'error');
        }
    })
    .catch(err => {
        console.error('Correction save error:', err);
        // Fallback local update
        const inv = invoices.find(i => i.id === invId);
        if (inv) {
            inv.expected_date = expectedDate;
            inv.status = 'Verified';
            inv.delay_days = calculateDelayDays(inv.due_date, expectedDate);
            renderInvoicesTable();
            recalculateEngine();
            showToast(`✓ Correction saved locally for ${inv.id}`, 'success');
        }
    });
}

function openUserCorrectionModal(invId) {
    const inv = invoices.find(i => i.id === invId);
    if (!inv) return;

    document.getElementById('correct-inv-id').value = inv.id;
    document.getElementById('correct-display-id').innerText = inv.id;
    document.getElementById('correct-display-customer').innerText = inv.customer;
    document.getElementById('correct-display-amount').innerText = `₹${Number(inv.amount).toLocaleString('en-IN')}`;
    document.getElementById('correct-display-due').innerText = inv.due_date;

    if (inv.expected_date) {
        document.getElementById('correct-expected-date').value = inv.expected_date;
    } else {
        const d = new Date(inv.due_date || '2026-09-10');
        const defaultDelay = inv.concentration_risk === 'HIGH' ? 15 : (inv.concentration_risk === 'MEDIUM' ? 7 : 5);
        d.setDate(d.getDate() + defaultDelay);
        document.getElementById('correct-expected-date').value = formatDateString(d);
    }

    calculateCorrectionDelay();
    const modal = document.getElementById('user-correction-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function calculateCorrectionDelay() {
    const invId = document.getElementById('correct-inv-id')?.value;
    const inv = invoices.find(i => i.id === invId);
    const dueDate = inv ? inv.due_date : document.getElementById('correct-display-due')?.innerText;
    const expectedDate = document.getElementById('correct-expected-date')?.value;
    const display = document.getElementById('correct-delay-display');
    if (!display) return;

    if (!expectedDate || !dueDate) {
        display.innerText = 'Not specified';
        display.className = 'px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-text-secondary';
        return;
    }

    const diff = calculateDelayDays(dueDate, expectedDate);
    if (diff > 0) {
        display.innerText = `+${diff} days delay`;
        display.className = 'px-3 py-1 rounded-lg text-xs font-black bg-orange-100 text-primary border border-primary/20';
    } else if (diff === 0) {
        display.innerText = '0 days (On time)';
        display.className = 'px-3 py-1 rounded-lg text-xs font-black bg-green-100 text-healthy border border-green-200';
    } else {
        display.innerText = `${Math.abs(diff)} days early`;
        display.className = 'px-3 py-1 rounded-lg text-xs font-black bg-green-100 text-healthy border border-green-200';
    }
}

function closeUserCorrectionModal() {
    const modal = document.getElementById('user-correction-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

function handleSaveUserCorrection(e) {
    if (e && e.preventDefault) e.preventDefault();
    const invId = document.getElementById('correct-inv-id')?.value;
    const expectedDate = document.getElementById('correct-expected-date')?.value;

    if (!invId || !expectedDate) {
        showToast('Please provide a valid expected payment date.', 'error');
        return false;
    }

    fetch(`/api/invoices/${encodeURIComponent(invId)}/correction/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ expected_date: expectedDate })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            const idx = invoices.findIndex(i => i.id === invId);
            if (idx !== -1) {
                invoices[idx].expected_date = expectedDate;
                invoices[idx].status = 'Verified';
                invoices[idx].delay_days = calculateDelayDays(invoices[idx].due_date, expectedDate);
            }

            closeUserCorrectionModal();
            if (data.baseline) {
                applyBaselineToAllScreens(data.baseline, data.calculated_at);
            } else {
                recalculateEngine();
            }

            renderInvoicesTable();
            addAuditEntry('User', `Verified expected payment date for ${invId}: set to ${expectedDate} (Status: Verified)`);
            showToast(`✓ Correction saved & baseline updated for ${invId}.`, 'success');
        } else {
            showToast(data.error || 'Failed to save correction.', 'error');
        }
    })
    .catch(err => {
        console.error('Modal correction error:', err);
        const inv = invoices.find(i => i.id === invId);
        if (inv) {
            inv.expected_date = expectedDate;
            inv.status = 'Verified';
            inv.delay_days = calculateDelayDays(inv.due_date, expectedDate);
            closeUserCorrectionModal();
            renderInvoicesTable();
            recalculateEngine();
            showToast(`Expected date updated for ${inv.id}.`, 'success');
        }
    });

    return false;
}

// ==========================================
// WHAT-IF SIMULATOR ENGINE
// ==========================================

function updateSimValueDisplay() {
    const delayEl = document.getElementById('sim-delay');
    const salesEl = document.getElementById('sim-sales');
    const expenseEl = document.getElementById('sim-expense');

    if (delayEl) document.getElementById('sim-delay-val').innerText = `+${delayEl.value} Days`;
    if (salesEl) document.getElementById('sim-sales-val').innerText = `${salesEl.value}%`;
    if (expenseEl) document.getElementById('sim-expense-val').innerText = `₹${parseInt(expenseEl.value).toLocaleString('en-IN')}`;
}

function runSimulation(logAudit = true) {
    simulationRun = true;

    const delay = parseInt(document.getElementById('sim-delay')?.value || 15);
    const sales = parseInt(document.getElementById('sim-sales')?.value || -10);
    const expense = parseInt(document.getElementById('sim-expense')?.value || 50000);

    const baseline = currentBaseline || calculateForecast(invoices, expenses, null);
    const targetCust = (baseline && baseline.top_customer && baseline.top_customer !== 'None') ? baseline.top_customer : '';

    const scenario = calculateForecast(invoices, expenses, {
        extraDelayDays: delay,
        salesVolumePct: sales,
        unexpectedExpenses: expense,
        targetCustomer: targetCust
    });

    const baselineMin = Number(baseline.projected_min_cash ?? baseline.projectedMinCash ?? 0);
    const baselineGap = Number(baseline.liquidity_gap ?? baseline.liquidityGap ?? 0);
    const baselineHasGap = baseline.has_liquidity_gap !== undefined ? Boolean(baseline.has_liquidity_gap) : baselineGap > 0;
    const baselineDate = baseline.pretty_min_cash_date || baseline.prettyMinCashDate || '18 September';

    const diffMinCash = scenario.projected_min_cash - baselineMin;
    const diffGap = scenario.liquidity_gap - baselineGap;

    // 1. Baseline Column UI
    const simBaseMin = document.getElementById('sim-baseline-min');
    if (simBaseMin) simBaseMin.innerText = `₹${baselineMin.toLocaleString('en-IN')}`;

    const simBaseGap = document.getElementById('sim-baseline-gap');
    if (simBaseGap) simBaseGap.innerText = baselineHasGap ? `₹${baselineGap.toLocaleString('en-IN')}` : '₹0 (Safe)';

    const simBaseDate = document.getElementById('sim-baseline-date');
    if (simBaseDate) simBaseDate.innerText = baselineDate;

    const simBaseStatus = document.getElementById('sim-baseline-status');
    if (simBaseStatus) {
        simBaseStatus.innerText = baselineHasGap ? (baselineGap >= 300000 ? 'Critical Deficit' : 'Deficit Risk') : 'Safe / Healthy';
        simBaseStatus.className = baselineHasGap ? 'text-[10px] font-bold text-critical' : 'text-[10px] font-bold text-healthy';
    }

    // 2. Scenario Column UI
    const outMin = document.getElementById('sim-out-min');
    if (outMin) {
        outMin.innerText = `₹${scenario.projected_min_cash.toLocaleString('en-IN')}`;
        outMin.className = scenario.has_liquidity_gap ? 'font-bold text-critical' : 'font-bold text-healthy';
    }

    const outGap = document.getElementById('sim-out-gap');
    if (outGap) {
        outGap.innerText = scenario.has_liquidity_gap ? `₹${scenario.liquidity_gap.toLocaleString('en-IN')}` : '₹0 (Safe)';
        outGap.className = scenario.has_liquidity_gap ? 'font-bold text-critical' : 'font-bold text-healthy';
    }

    const outDate = document.getElementById('sim-out-date');
    if (outDate) outDate.innerText = scenario.has_liquidity_gap ? scenario.pretty_min_cash_date : 'No Deficit';

    const outStatus = document.getElementById('sim-out-status');
    if (outStatus) {
        outStatus.innerText = scenario.has_liquidity_gap ? (scenario.liquidity_gap >= 300000 ? 'Critical Deficit' : 'Deficit Risk') : 'Safe / Healthy';
        outStatus.className = scenario.has_liquidity_gap ? 'text-[10px] font-bold text-critical' : 'text-[10px] font-bold text-healthy';
    }

    // 3. Delta Variance Column UI
    const diffMinEl = document.getElementById('sim-diff-min');
    if (diffMinEl) {
        const sign = diffMinCash >= 0 ? '+' : '-';
        diffMinEl.innerText = `${sign}₹${Math.abs(diffMinCash).toLocaleString('en-IN')}`;
        diffMinEl.className = diffMinCash >= 0 ? 'font-bold text-healthy' : 'font-bold text-critical';
    }

    const diffGapEl = document.getElementById('sim-diff-gap');
    if (diffGapEl) {
        const sign = diffGap <= 0 ? '-' : '+';
        diffGapEl.innerText = `${sign}₹${Math.abs(diffGap).toLocaleString('en-IN')}`;
        diffGapEl.className = diffGap <= 0 ? 'font-bold text-healthy' : 'font-bold text-critical';
    }

    const diffDateEl = document.getElementById('sim-diff-date');
    if (diffDateEl) {
        if (!scenario.has_liquidity_gap) {
            diffDateEl.innerText = 'Gap Eliminated';
            diffDateEl.className = 'font-bold text-healthy';
        } else if (scenario.pretty_min_cash_date === baselineDate) {
            diffDateEl.innerText = 'Same Timing';
            diffDateEl.className = 'font-bold text-text-secondary';
        } else {
            diffDateEl.innerText = `Shifted to ${scenario.pretty_min_cash_date}`;
            diffDateEl.className = 'font-bold text-attention';
        }
    }

    const diffRiskEl = document.getElementById('sim-diff-risk');
    if (diffRiskEl) {
        if (!scenario.has_liquidity_gap && baselineHasGap) {
            diffRiskEl.innerText = 'Deficit Cleared (Safe)';
            diffRiskEl.className = 'text-[10px] font-bold text-healthy';
        } else if (scenario.liquidity_gap > baselineGap) {
            diffRiskEl.innerText = 'Deficit Escalates';
            diffRiskEl.className = 'text-[10px] font-bold text-critical';
        } else if (scenario.liquidity_gap < baselineGap) {
            diffRiskEl.innerText = 'Deficit Reduced';
            diffRiskEl.className = 'text-[10px] font-bold text-healthy';
        } else {
            diffRiskEl.innerText = 'Unchanged';
            diffRiskEl.className = 'text-[10px] font-bold text-text-secondary';
        }
    }

    const badge = document.getElementById('sim-status-badge');
    if (badge) {
        if (scenario.liquidity_gap >= 300000) {
            badge.innerText = 'Critical Deficit';
            badge.className = 'text-[10px] font-bold text-critical bg-red-50 px-2 py-0.5 rounded';
        } else if (scenario.liquidity_gap > 0) {
            badge.innerText = 'High Risk';
            badge.className = 'text-[10px] font-bold text-attention bg-amber-50 px-2 py-0.5 rounded';
        } else {
            badge.innerText = 'Resilient';
            badge.className = 'text-[10px] font-bold text-healthy bg-green-50 px-2 py-0.5 rounded';
        }
    }

    const barSim = document.getElementById('sim-bar-simulated');
    const barSimLabel = document.getElementById('sim-bar-simulated-label');
    if (barSim) {
        const simHeight = Math.min(80, Math.max(10, Math.round((scenario.projected_min_cash / 520000) * 80)));
        barSim.style.height = `${simHeight}px`;
        barSim.className = scenario.has_liquidity_gap ? 'w-12 bg-critical rounded-t-md transition-all' : 'w-12 bg-healthy rounded-t-md transition-all';
    }
    if (barSimLabel) {
        barSimLabel.innerText = `Scenario Min: ₹${(scenario.projected_min_cash / 100000).toFixed(1)}L`;
        barSimLabel.className = scenario.has_liquidity_gap ? 'text-[9px] font-bold text-critical mt-1' : 'text-[9px] font-bold text-healthy mt-1';
    }

    if (logAudit) {
        addAuditEntry('What-If Simulator', `Run simulation parameters - Delay: +${delay}d, Sales: ${sales}%, Unexpected: ₹${expense.toLocaleString('en-IN')}`);
        updateSvgChart(scenario.projected_min_cash, scenario.pretty_min_cash_date);
    }
}

function updateSvgChart(simMinCash, gapDateStr = '18 September', isScenario = false) {
    const projectedPath = document.getElementById('chart-projected-path');
    const simPath = document.getElementById('chart-simulated-path');
    const simLegend = document.getElementById('chart-legend-sim');
    const riskPoint = document.getElementById('chart-risk-point');

    if (!projectedPath || !riskPoint) return;

    const points = (currentBaseline && Array.isArray(currentBaseline.timeline_points) && currentBaseline.timeline_points.length > 0)
        ? currentBaseline.timeline_points
        : [];

    if (points.length === 0) {
        projectedPath.setAttribute('d', 'M 40 200 L 760 200');
        riskPoint.setAttribute('cx', '-100');
        riskPoint.setAttribute('cy', '-100');
        if (simPath) simPath.classList.add('hidden');
        if (simLegend) simLegend.classList.add('hidden');
        return;
    }

    const balances = points.map(p => Number(p.balance) || 0);
    const minB = Math.min(0, ...balances);
    const maxB = Math.max(200000, ...balances) * 1.15;
    const range = (maxB - minB) || 1;

    // Build baseline SVG path coordinates
    const coords = points.map((p, idx) => {
        const x = Math.round(40 + (idx / Math.max(1, points.length - 1)) * 720);
        const y = Math.round(210 - (((Number(p.balance) || 0) - minB) / range) * 170);
        return { x, y, point: p };
    });

    const dStr = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    projectedPath.setAttribute('d', dStr);

    // Position risk dip point on lowest balance coordinate
    let lowestCoord = coords[0];
    coords.forEach(c => {
        if (c.point.balance < lowestCoord.point.balance) {
            lowestCoord = c;
        }
    });

    if (lowestCoord && lowestCoord.point.balance < (currentBaseline.safe_threshold || 150000)) {
        riskPoint.setAttribute('cx', String(lowestCoord.x));
        riskPoint.setAttribute('cy', String(lowestCoord.y));
        riskPoint.setAttribute('fill', '#DC2626');
    } else {
        riskPoint.setAttribute('cx', String(lowestCoord.x));
        riskPoint.setAttribute('cy', String(lowestCoord.y));
        riskPoint.setAttribute('fill', '#16A34A');
    }

    if (isScenario && simPath) {
        simPath.classList.remove('hidden');
        if (simLegend) simLegend.classList.remove('hidden');
        const simCoords = coords.map(c => {
            const ySim = simMinCash < (currentBaseline.safe_threshold || 150000) ? Math.min(230, c.y + 15) : Math.max(40, c.y - 15);
            return `${c.x} ${ySim}`;
        });
        simPath.setAttribute('d', `M ${simCoords.join(' L ')}`);
    } else {
        if (simPath) simPath.classList.add('hidden');
        if (simLegend) simLegend.classList.add('hidden');
    }
}

// Interactive Synchronized Hover Tooltip & Crosshair
function initChartInteractivity() {
    const overlay = document.getElementById('chart-hover-overlay');
    const tooltip = document.getElementById('chart-floating-tooltip');
    const crosshair = document.getElementById('chart-crosshair');
    const dotBase = document.getElementById('chart-dot-baseline');
    const dotSim = document.getElementById('chart-dot-scenario');
    const viewport = document.getElementById('chart-viewport');

    if (!overlay || !tooltip || !crosshair || !dotBase || !viewport) return;

    function getActiveTimelinePoints() {
        if (currentBaseline && Array.isArray(currentBaseline.timeline_points) && currentBaseline.timeline_points.length > 0) {
            const count = currentBaseline.timeline_points.length;
            return currentBaseline.timeline_points.map((p, idx) => ({
                pct: count === 1 ? 0.5 : (idx / (count - 1)),
                date: p.date,
                baseVal: Number(p.balance) || 0,
                simVal: Number(p.balance) || 0,
                event: p.desc || (p.type === 'expense' ? `Expense Outflow (-₹${Math.abs(p.delta).toLocaleString('en-IN')})` : `Inflow (+₹${p.delta.toLocaleString('en-IN')})`)
            }));
        }
        return [];
    }

    function handlePointer(e) {
        const sampleDates = getActiveTimelinePoints();
        if (sampleDates.length === 0) return;

        const rect = overlay.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const svgX = relX * 800;

        let closest = sampleDates[0];
        let minDist = 999;
        sampleDates.forEach(d => {
            const dist = Math.abs(d.pct - relX);
            if (dist < minDist) {
                minDist = dist;
                closest = d;
            }
        });

        const maxVal = Math.max(200000, ...sampleDates.map(d => d.baseVal)) * 1.15;
        const yBase = Math.round(210 - (closest.baseVal / maxVal) * 170);
        const ySim = Math.round(210 - (closest.simVal / maxVal) * 170);

        crosshair.setAttribute('x1', svgX);
        crosshair.setAttribute('x2', svgX);
        dotBase.setAttribute('cx', svgX);
        dotBase.setAttribute('cy', yBase);

        if (simulationRun && dotSim) {
            dotSim.classList.remove('hidden');
            dotSim.setAttribute('cx', svgX);
            dotSim.setAttribute('cy', ySim);
        }

        document.getElementById('tt-date').innerText = closest.date;
        const ttBaseVal = document.getElementById('tt-baseline-val');
        if (ttBaseVal) {
            ttBaseVal.innerText = `₹${closest.baseVal.toLocaleString('en-IN')}`;
            ttBaseVal.className = closest.baseVal < 150000 ? 'font-bold text-critical font-mono' : 'font-bold text-healthy font-mono';
        }

        const ttSimRow = document.getElementById('tt-sim-row');
        const ttSimVal = document.getElementById('tt-sim-val');
        if (simulationRun && ttSimRow && ttSimVal) {
            ttSimRow.classList.remove('hidden');
            ttSimVal.innerText = `₹${closest.simVal.toLocaleString('en-IN')}`;
            ttSimVal.className = closest.simVal < 150000 ? 'font-bold text-critical font-mono' : 'font-bold text-purple-700 font-mono';
        } else if (ttSimRow) {
            ttSimRow.classList.add('hidden');
        }

        const ttEvent = document.getElementById('tt-event-desc');
        if (ttEvent) ttEvent.innerText = closest.event;

        tooltip.classList.remove('hidden');
        const ttWidth = 200;
        let leftPx = (clientX - rect.left) - (ttWidth / 2);
        leftPx = Math.max(10, Math.min(rect.width - ttWidth - 10, leftPx));
        tooltip.style.left = `${leftPx}px`;
        tooltip.style.top = '12px';
    }

    function hideTooltip() {
        tooltip.classList.add('hidden');
        crosshair.setAttribute('x1', '-100');
        crosshair.setAttribute('x2', '-100');
        dotBase.setAttribute('cx', '-100');
        if (dotSim) dotSim.setAttribute('cx', '-100');
    }

    overlay.addEventListener('mousemove', handlePointer);
    overlay.addEventListener('mouseleave', hideTooltip);
    overlay.addEventListener('touchmove', handlePointer, { passive: true });
    overlay.addEventListener('touchend', hideTooltip);
}

// ==========================================
// INVOICES DATABASE CRUD
// ==========================================

function renderInvoicesTable() {
    const tbody = document.getElementById('invoice-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!invoices || invoices.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="px-6 py-8 text-center text-text-secondary">
                    No invoices recorded yet. Click <strong>+ Add Invoice</strong> to create one.
                </td>
            </tr>
        `;
        return;
    }

    invoices.forEach(inv => {
        const expectedText = inv.expected_date
            ? `<span class="text-text-primary font-medium">${inv.expected_date}</span>`
            : '<span class="text-attention font-bold">⚠️ MISSING</span>';

        let delayDaysText = '-';
        if (inv.delay_days !== null && inv.delay_days !== undefined && inv.delay_days !== '') {
            const d = Number(inv.delay_days);
            if (d > 0) {
                delayDaysText = `<span class="text-attention font-bold">+${d}d</span>`;
            } else if (d === 0) {
                delayDaysText = `<span class="text-healthy font-semibold">0d</span>`;
            } else {
                delayDaysText = `<span class="text-healthy font-semibold">${d}d</span>`;
            }
        }

        const concStr = (inv.concentration_risk || 'Medium').toUpperCase();
        const concentrationClass = concStr === 'HIGH'
            ? 'bg-red-50 text-critical border border-red-200'
            : (concStr === 'MEDIUM' ? 'bg-amber-50 text-attention border border-amber-200' : 'bg-green-50 text-healthy border border-green-200');

        const statusStr = (inv.status || 'Pending');
        let statusClass = 'bg-gray-100 text-text-secondary';
        if (statusStr.toLowerCase() === 'paid') {
            statusClass = 'bg-green-50 text-healthy border border-green-200';
        } else if (statusStr.toLowerCase() === 'verified') {
            statusClass = 'bg-green-50 text-healthy border border-green-200 font-bold';
        } else if (statusStr.toLowerCase() === 'needs review') {
            statusClass = 'bg-amber-50 text-attention border border-amber-200 font-bold';
        } else if (statusStr.toLowerCase() === 'overdue') {
            statusClass = 'bg-red-50 text-critical border border-red-200';
        }

        const row = `
            <tr class="hover:bg-[#FFFDF9]/60 transition-colors">
                <td class="px-5 py-3.5 font-mono font-bold text-primary">${inv.id}</td>
                <td class="px-5 py-3.5 font-semibold text-text-primary">${inv.customer}</td>
                <td class="px-5 py-3.5 font-bold text-text-primary">₹${Number(inv.amount).toLocaleString('en-IN')}</td>
                <td class="px-5 py-3.5 text-text-secondary font-mono text-[11px]">${inv.due_date || '-'}</td>
                <td class="px-5 py-3.5 font-mono text-[11px]">${expectedText}</td>
                <td class="px-5 py-3.5 font-mono text-[11px]">${delayDaysText}</td>
                <td class="px-5 py-3.5">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${concentrationClass}">
                        ${inv.concentration_risk || 'Medium'}
                    </span>
                </td>
                <td class="px-5 py-3.5">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">
                        ${inv.status || 'Pending'}
                    </span>
                </td>
                <td class="px-5 py-3.5 text-right space-x-1 whitespace-nowrap">
                    <button type="button" onclick="openEditInvoiceModal('${inv.id}')"
                        class="p-1.5 text-text-secondary hover:text-primary hover:bg-orange-50 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center"
                        title="Edit Invoice">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                    </button>
                    <button type="button" onclick="confirmDeleteInvoice('${inv.id}')"
                        class="p-1.5 text-text-secondary hover:text-critical hover:bg-red-50 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center"
                        title="Delete Invoice">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function calculateDelayFromForm() {
    const dueDate = document.getElementById('inv-due-date')?.value;
    const expectedDate = document.getElementById('inv-expected-date')?.value;
    const delayDisplay = document.getElementById('inv-delay-display');
    if (!delayDisplay) return null;

    if (!dueDate) {
        delayDisplay.innerText = 'Select Due Date';
        delayDisplay.className = 'px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-text-secondary border border-border';
        return null;
    }

    if (!expectedDate) {
        delayDisplay.innerText = 'Not specified';
        delayDisplay.className = 'px-3 py-1 rounded-lg text-xs font-semibold bg-amber-100/60 text-attention border border-amber-200';
        return null;
    }

    const diff = calculateDelayDays(dueDate, expectedDate);
    if (diff === null) {
        delayDisplay.innerText = '-';
        return null;
    }

    if (diff > 0) {
        delayDisplay.innerText = `+${diff} days delay`;
        delayDisplay.className = 'px-3 py-1 rounded-lg text-xs font-black bg-red-100/80 text-critical border border-red-200';
    } else if (diff === 0) {
        delayDisplay.innerText = '0 days (On time)';
        delayDisplay.className = 'px-3 py-1 rounded-lg text-xs font-black bg-green-100/80 text-healthy border border-green-200';
    } else {
        delayDisplay.innerText = `${Math.abs(diff)} days early`;
        delayDisplay.className = 'px-3 py-1 rounded-lg text-xs font-black bg-green-100/80 text-healthy border border-green-200';
    }
    return diff;
}

function openAddInvoiceModal() {
    const form = document.getElementById('invoice-form');
    if (form) form.reset();

    const editIdEl = document.getElementById('invoice-edit-id');
    if (editIdEl) editIdEl.value = '';
    const titleEl = document.getElementById('invoice-modal-title');
    if (titleEl) titleEl.innerText = 'Add New Invoice';
    const submitText = document.getElementById('invoice-submit-text');
    if (submitText) submitText.innerText = 'Save Invoice';

    let maxNum = 0;
    invoices.forEach(inv => {
        const match = inv.id && String(inv.id).match(/\d+$/);
        if (match) {
            const num = parseInt(match[0], 10);
            if (num > maxNum) maxNum = num;
        }
    });
    const nextNum = String(maxNum + 1).padStart(3, '0');
    const invIdEl = document.getElementById('inv-id');
    if (invIdEl) {
        invIdEl.value = `INV-2026-${nextNum}`;
        invIdEl.removeAttribute('readonly');
    }

    const custEl = document.getElementById('inv-customer');
    if (custEl) custEl.value = '';
    const amtEl = document.getElementById('inv-amount');
    if (amtEl) amtEl.value = '';
    const dueEl = document.getElementById('inv-due-date');
    if (dueEl) dueEl.value = '2026-09-15';
    const expDateEl = document.getElementById('inv-expected-date');
    if (expDateEl) expDateEl.value = '2026-09-22';
    const concEl = document.getElementById('inv-concentration');
    if (concEl) concEl.value = 'Medium';
    const statusEl = document.getElementById('inv-status');
    if (statusEl) statusEl.value = 'Pending';

    calculateDelayFromForm();
    const modal = document.getElementById('invoice-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function openEditInvoiceModal(invId) {
    const inv = invoices.find(i => i.id === invId);
    if (!inv) return;

    const editIdEl = document.getElementById('invoice-edit-id');
    if (editIdEl) editIdEl.value = inv.id;
    const idEl = document.getElementById('inv-id');
    if (idEl) {
        idEl.value = inv.id;
        idEl.setAttribute('readonly', 'true');
    }
    const custEl = document.getElementById('inv-customer');
    if (custEl) custEl.value = inv.customer || '';
    const amtEl = document.getElementById('inv-amount');
    if (amtEl) amtEl.value = inv.amount || '';

    const conc = (inv.concentration_risk || 'Medium').toUpperCase();
    const concVal = conc === 'HIGH' ? 'High' : (conc === 'LOW' ? 'Low' : 'Medium');
    const concEl = document.getElementById('inv-concentration');
    if (concEl) concEl.value = concVal;

    const statusEl = document.getElementById('inv-status');
    if (statusEl) statusEl.value = inv.status || 'Pending';
    const dueEl = document.getElementById('inv-due-date');
    if (dueEl) dueEl.value = inv.due_date || '';
    const expEl = document.getElementById('inv-expected-date');
    if (expEl) expEl.value = inv.expected_date || '';

    const titleEl = document.getElementById('invoice-modal-title');
    if (titleEl) titleEl.innerText = `Edit Invoice (${inv.id})`;
    const submitText = document.getElementById('invoice-submit-text');
    if (submitText) submitText.innerText = 'Save Changes';

    calculateDelayFromForm();
    const modal = document.getElementById('invoice-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function closeInvoiceModal() {
    const modal = document.getElementById('invoice-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

function handleSaveInvoice(e) {
    if (e) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
    }

    const editId = (document.getElementById('invoice-edit-id')?.value || '').trim();
    const invId = (document.getElementById('inv-id')?.value || '').trim();
    const customer = (document.getElementById('inv-customer')?.value || '').trim();
    const amountVal = document.getElementById('inv-amount')?.value;
    const amount = parseFloat(amountVal) || 0;
    const concentration = document.getElementById('inv-concentration')?.value || 'Medium';
    const status = document.getElementById('inv-status')?.value || 'Pending';
    const dueDate = document.getElementById('inv-due-date')?.value || '';
    const expectedDate = document.getElementById('inv-expected-date')?.value || null;

    if (!invId) {
        showToast('Please enter an Invoice ID.', 'error');
        return false;
    }

    if (!editId) {
        const isDuplicate = invoices.some(inv => inv.id && inv.id.toLowerCase() === invId.toLowerCase());
        if (isDuplicate) {
            showToast(`Invoice with ID "${invId}" already exists. Please enter a unique ID.`, 'error');
            return false;
        }
    }

    if (!customer) {
        showToast('Please enter a Customer Name.', 'error');
        return false;
    }
    if (amount <= 0 || isNaN(amount)) {
        showToast('Please enter a valid Invoice Amount greater than 0.', 'error');
        return false;
    }
    if (!dueDate) {
        showToast('Please select a Due Date.', 'error');
        return false;
    }

    const payload = {
        invoice_id: invId,
        customer: customer,
        amount: amount,
        due_date: dueDate,
        expected_date: expectedDate,
        concentration_risk: concentration.toUpperCase(),
        status: status
    };

    const submitBtn = document.getElementById('invoice-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    const url = editId ? `/api/invoices/${encodeURIComponent(editId)}/` : '/api/invoices/';

    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (submitBtn) submitBtn.disabled = false;
        if (data.success) {
            const savedInvoice = data.invoice || payload;
            if (editId) {
                const idx = invoices.findIndex(i => i.id === editId);
                if (idx !== -1) invoices[idx] = savedInvoice;
                addAuditEntry('User (finance@abcmfg.in)', `Updated invoice ${invId} for ${customer} (₹${amount.toLocaleString('en-IN')})`);
                showToast(`Invoice ${invId} updated successfully.`, 'success');
            } else {
                invoices.unshift(savedInvoice);
                addAuditEntry('User (finance@abcmfg.in)', `Created new invoice ${invId} for ${customer} (₹${amount.toLocaleString('en-IN')})`);
                showToast(`Invoice ${invId} saved to database.`, 'success');
            }

            closeInvoiceModal();
            renderInvoicesTable();
            triggerForecastRecalculation();
            switchScreen('invoices');
        } else {
            showToast(data.error || 'Failed to save invoice.', 'error');
        }
    })
    .catch(err => {
        if (submitBtn) submitBtn.disabled = false;
        console.error('Error saving invoice:', err);
        const delayDays = calculateDelayDays(dueDate, expectedDate);
        const fallbackInv = {
            id: invId,
            customer: customer,
            amount: amount,
            due_date: dueDate,
            expected_date: expectedDate,
            delay_days: delayDays,
            concentration_risk: concentration.toUpperCase(),
            status: status
        };
        if (editId) {
            const idx = invoices.findIndex(i => i.id === editId);
            if (idx !== -1) invoices[idx] = fallbackInv;
        } else {
            invoices.unshift(fallbackInv);
        }
        closeInvoiceModal();
        renderInvoicesTable();
        recalculateEngine();
        switchScreen('invoices');
        showToast(`Invoice ${invId} saved.`, 'success');
    });

    return false;
}

function confirmDeleteInvoice(invId) {
    pendingDeleteInvoiceId = invId;
    const label = document.getElementById('delete-modal-inv-id');
    if (label) label.innerText = invId;
    const modal = document.getElementById('delete-confirm-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function closeDeleteModal() {
    pendingDeleteInvoiceId = null;
    const modal = document.getElementById('delete-confirm-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

function executeDeleteInvoice() {
    if (!pendingDeleteInvoiceId) return;
    const deletedId = pendingDeleteInvoiceId;

    fetch(`/api/invoices/${encodeURIComponent(deletedId)}/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ action: 'delete' })
    })
    .then(res => res.json())
    .then(data => {
        invoices = invoices.filter(i => i.id !== deletedId);
        closeDeleteModal();
        addAuditEntry('User (finance@abcmfg.in)', `Deleted invoice ${deletedId}`);
        renderInvoicesTable();
        triggerForecastRecalculation();
        switchScreen('invoices');
        showToast(`Invoice ${deletedId} deleted from database.`, 'info');
    })
    .catch(err => {
        console.error('Delete invoice error:', err);
        invoices = invoices.filter(i => i.id !== deletedId);
        closeDeleteModal();
        renderInvoicesTable();
        recalculateEngine();
        switchScreen('invoices');
        showToast(`Invoice ${deletedId} deleted.`, 'info');
    });
}

// ==========================================
// EXPENSES DATABASE CRUD
// ==========================================

function renderExpensesTable() {
    const tbody = document.getElementById('expenses-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!expenses || expenses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="px-6 py-8 text-center text-text-secondary">
                    No expenses recorded yet. Click <strong>+ Add Expense</strong> to schedule one.
                </td>
            </tr>
        `;
        return;
    }

    expenses.forEach(exp => {
        const statusStr = exp.status || 'Upcoming';
        const statusClass = statusStr.toLowerCase() === 'paid'
            ? 'bg-green-50 text-healthy border border-green-200'
            : (statusStr.toLowerCase() === 'pending' ? 'bg-red-50 text-critical border border-red-200' : 'bg-amber-50 text-attention border border-amber-200');

        const row = `
            <tr class="hover:bg-[#FFFDF9]/60 transition-colors">
                <td class="px-5 py-3.5 font-mono font-bold text-text-secondary">${exp.id}</td>
                <td class="px-5 py-3.5 font-semibold text-text-primary">${exp.payee}</td>
                <td class="px-5 py-3.5 text-text-secondary text-xs">${exp.category || 'General'}</td>
                <td class="px-5 py-3.5 font-bold text-text-primary">₹${Number(exp.amount).toLocaleString('en-IN')}</td>
                <td class="px-5 py-3.5 text-text-secondary font-mono text-[11px]">${exp.due_date || '-'}</td>
                <td class="px-5 py-3.5">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">
                        ${exp.status || 'Upcoming'}
                    </span>
                </td>
                <td class="px-5 py-3.5 text-right space-x-1 whitespace-nowrap">
                    <button type="button" onclick="openEditExpenseModal('${exp.id}')"
                        class="p-1.5 text-text-secondary hover:text-primary hover:bg-orange-50 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center"
                        title="Edit Expense">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                    </button>
                    <button type="button" onclick="confirmDeleteExpense('${exp.id}')"
                        class="p-1.5 text-text-secondary hover:text-critical hover:bg-red-50 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center"
                        title="Delete Expense">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function openAddExpenseModal() {
    const form = document.getElementById('expense-form');
    if (form) form.reset();

    const editIdEl = document.getElementById('expense-edit-id');
    if (editIdEl) editIdEl.value = '';
    const titleEl = document.getElementById('expense-modal-title');
    if (titleEl) titleEl.innerText = 'Add New Expense';
    const submitText = document.getElementById('expense-submit-text');
    if (submitText) submitText.innerText = 'Save Expense';

    let maxNum = 100;
    expenses.forEach(exp => {
        const match = exp.id && String(exp.id).match(/\d+$/);
        if (match) {
            const num = parseInt(match[0], 10);
            if (num > maxNum) maxNum = num;
        }
    });
    const nextNum = maxNum + 1;
    const expIdEl = document.getElementById('exp-id');
    if (expIdEl) {
        expIdEl.value = `EXP-2026-${nextNum}`;
        expIdEl.removeAttribute('readonly');
    }

    const payeeEl = document.getElementById('exp-payee');
    if (payeeEl) payeeEl.value = '';
    const amtEl = document.getElementById('exp-amount');
    if (amtEl) amtEl.value = '';
    const catEl = document.getElementById('exp-category');
    if (catEl) catEl.value = 'Raw Materials';
    const statusEl = document.getElementById('exp-status');
    if (statusEl) statusEl.value = 'Upcoming';
    const dueEl = document.getElementById('exp-due-date');
    if (dueEl) dueEl.value = '2026-09-20';

    const modal = document.getElementById('expense-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function openEditExpenseModal(expId) {
    const exp = expenses.find(e => e.id === expId);
    if (!exp) return;

    const editIdEl = document.getElementById('expense-edit-id');
    if (editIdEl) editIdEl.value = exp.id;
    const idEl = document.getElementById('exp-id');
    if (idEl) {
        idEl.value = exp.id;
        idEl.setAttribute('readonly', 'true');
    }
    const payeeEl = document.getElementById('exp-payee');
    if (payeeEl) payeeEl.value = exp.payee || '';
    const catEl = document.getElementById('exp-category');
    if (catEl) catEl.value = exp.category || 'Raw Materials';
    const amtEl = document.getElementById('exp-amount');
    if (amtEl) amtEl.value = exp.amount || '';
    const dueEl = document.getElementById('exp-due-date');
    if (dueEl) dueEl.value = exp.due_date || '';
    const statusEl = document.getElementById('exp-status');
    if (statusEl) statusEl.value = exp.status || 'Upcoming';

    const titleEl = document.getElementById('expense-modal-title');
    if (titleEl) titleEl.innerText = `Edit Expense (${exp.id})`;
    const submitText = document.getElementById('expense-submit-text');
    if (submitText) submitText.innerText = 'Save Changes';

    const modal = document.getElementById('expense-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function closeExpenseModal() {
    const modal = document.getElementById('expense-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

function handleSaveExpense(e) {
    if (e) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
    }

    const editId = (document.getElementById('expense-edit-id')?.value || '').trim();
    const expId = (document.getElementById('exp-id')?.value || '').trim();
    const payee = (document.getElementById('exp-payee')?.value || '').trim();
    const category = document.getElementById('exp-category')?.value || 'Raw Materials';
    const amountVal = document.getElementById('exp-amount')?.value;
    const amount = parseFloat(amountVal) || 0;
    const dueDate = document.getElementById('exp-due-date')?.value || '';
    const status = document.getElementById('exp-status')?.value || 'Upcoming';

    if (!expId) {
        showToast('Please enter an Expense ID.', 'error');
        return false;
    }

    if (!editId) {
        const isDuplicate = expenses.some(exp => exp.id && exp.id.toLowerCase() === expId.toLowerCase());
        if (isDuplicate) {
            showToast(`Expense with ID "${expId}" already exists. Please enter a unique ID.`, 'error');
            return false;
        }
    }

    if (!payee) {
        showToast('Please enter a Payee Name.', 'error');
        return false;
    }
    if (amount <= 0 || isNaN(amount)) {
        showToast('Please enter a valid Expense Amount greater than 0.', 'error');
        return false;
    }
    if (!dueDate) {
        showToast('Please select a Due Date.', 'error');
        return false;
    }

    const payload = {
        expense_id: expId,
        payee: payee,
        category: category,
        amount: amount,
        due_date: dueDate,
        status: status
    };

    const submitBtn = document.getElementById('expense-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    const url = editId ? `/api/expenses/${encodeURIComponent(editId)}/` : '/api/expenses/';

    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (submitBtn) submitBtn.disabled = false;
        if (data.success) {
            const savedExp = data.expense || payload;
            if (editId) {
                const idx = expenses.findIndex(e => e.id === editId);
                if (idx !== -1) expenses[idx] = savedExp;
                addAuditEntry('User (finance@abcmfg.in)', `Updated expense ${expId} for ${payee} (₹${amount.toLocaleString('en-IN')})`);
                showToast(`Expense ${expId} updated successfully.`, 'success');
            } else {
                expenses.push(savedExp);
                addAuditEntry('User (finance@abcmfg.in)', `Created new scheduled expense ${expId} for ${payee} (₹${amount.toLocaleString('en-IN')})`);
                showToast(`Expense ${expId} saved to database.`, 'success');
            }

            closeExpenseModal();
            renderExpensesTable();
            triggerForecastRecalculation();
            switchScreen('expenses');
        } else {
            showToast(data.error || 'Failed to save expense.', 'error');
        }
    })
    .catch(err => {
        if (submitBtn) submitBtn.disabled = false;
        console.error('Error saving expense:', err);
        const fallbackExp = {
            id: expId,
            payee: payee,
            category: category,
            amount: amount,
            due_date: dueDate,
            status: status
        };
        if (editId) {
            const idx = expenses.findIndex(e => e.id === editId);
            if (idx !== -1) expenses[idx] = fallbackExp;
        } else {
            expenses.push(fallbackExp);
        }
        closeExpenseModal();
        renderExpensesTable();
        recalculateEngine();
        switchScreen('expenses');
        showToast(`Expense ${expId} saved.`, 'success');
    });

    return false;
}

function confirmDeleteExpense(expId) {
    pendingDeleteExpenseId = expId;
    const label = document.getElementById('delete-modal-exp-id');
    if (label) label.innerText = expId;
    const modal = document.getElementById('delete-expense-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function closeDeleteExpenseModal() {
    pendingDeleteExpenseId = null;
    const modal = document.getElementById('delete-expense-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

function executeDeleteExpense() {
    if (!pendingDeleteExpenseId) return;
    const deletedId = pendingDeleteExpenseId;

    fetch(`/api/expenses/${encodeURIComponent(deletedId)}/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ action: 'delete' })
    })
    .then(res => res.json())
    .then(data => {
        expenses = expenses.filter(e => e.id !== deletedId);
        closeDeleteExpenseModal();
        addAuditEntry('User (finance@abcmfg.in)', `Deleted expense ${deletedId}`);
        renderExpensesTable();
        triggerForecastRecalculation();
        switchScreen('expenses');
        showToast(`Expense ${deletedId} deleted from database.`, 'info');
    })
    .catch(err => {
        console.error('Delete expense error:', err);
        expenses = expenses.filter(e => e.id !== deletedId);
        closeDeleteExpenseModal();
        renderExpensesTable();
        recalculateEngine();
        switchScreen('expenses');
        showToast(`Expense ${deletedId} deleted.`, 'info');
    });
}

// ==========================================
// USER PROFILE & LOGOUT
// ==========================================

function toggleUserMenu() {
    const menu = document.getElementById('user-profile-menu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

function openProfileModal() {
    const menu = document.getElementById('user-profile-menu');
    if (menu) menu.classList.add('hidden');
    const modal = document.getElementById('profile-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function closeProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

function handleLogout(e) {
    if (e && e.preventDefault) e.preventDefault();
    window.location.href = '/logout/';
}

// ==========================================
// AUDIT LOGGING & STRATEGY SELECTION
// ==========================================

function renderAuditLogs() {
    const tbody = document.getElementById('audit-log-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    [...auditLogs].reverse().forEach(log => {
        const row = `
            <tr class="hover:bg-[#FFFDF9]/40 transition-colors">
                <td class="px-6 py-4 text-text-secondary font-mono text-[11px]">${log.time}</td>
                <td class="px-6 py-4 font-semibold text-text-primary">${log.entity}</td>
                <td class="px-6 py-4 text-text-secondary">${log.event}</td>
                <td class="px-6 py-4 font-mono text-text-secondary text-[11px]">${log.ip}</td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function addAuditEntry(entity, event) {
    const now = new Date();
    const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);
    auditLogs.push({
        time: formattedDate,
        entity: entity,
        event: event,
        ip: '192.168.1.45'
    });
    renderAuditLogs();
}

function selectResilienceOption(optionId) {
    appliedResilienceOption = optionId;
    let strategyName = '';

    if (optionId === 1) {
        strategyName = 'Invoice Discounting (ABC Retail)';
        alert(`Resilience Option Selected: ADVANCE RECEIVABLES.\n\nApplying this models an immediate cash injection of ₹3,60,000, completely eliminating the projected liquidity gap.\n\nVerify this simulation by checking the updated Cash Flow view.`);
    } else if (optionId === 2) {
        strategyName = 'Bank Overdraft Drawdown';
        alert(`Resilience Option Selected: OVERDRAFT DRAWDOWN.\n\nDrawing ₹2,00,000 decreases the gap but does not clear it completely.\n\nVerify this simulation by checking the updated Cash Flow view.`);
    } else if (optionId === 3) {
        strategyName = 'Steel Supplies AP Deferral';
        alert(`Resilience Option Selected: SUPPLIER AP DEFERRAL.\n\nDeploys negotiated extension terms for Steel Supplies (deferring ₹5,00,000 outflow by 15 days), shifting the gap completely out of the September timeframe.`);
    }

    addAuditEntry('User (finance@abcmfg.in)', `Simulated resilience options check: Applied strategy [${strategyName}]`);
}

// Reset Demo Flow State
function resetDemoFlow() {
    fetch('/api/reset-demo/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            invoices = data.invoices;
            expenses = data.expenses;
            if (data.baseline) {
                applyBaselineToAllScreens(data.baseline, new Date().toLocaleString('en-IN'));
            }
        }
        simulationRun = false;
        appliedResilienceOption = null;
        auditLogs = JSON.parse(JSON.stringify(DEFAULT_AUDIT_LOGS));
        renderAuditLogs();

        const simDelay = document.getElementById('sim-delay');
        if (simDelay) simDelay.value = 15;
        const simSales = document.getElementById('sim-sales');
        if (simSales) simSales.value = -10;
        const simExpense = document.getElementById('sim-expense');
        if (simExpense) simExpense.value = 50000;
        updateSimValueDisplay();

        renderInvoicesTable();
        renderExpensesTable();
        recalculateEngine();
        switchScreen('dashboard');
        showToast('Demo environment reset to initial demonstration baseline.', 'info');
    })
    .catch(err => {
        console.error('Reset error:', err);
        location.reload();
    });
}

function togglePlaybook() {
    const body = document.getElementById('playbook-body');
    const header = document.getElementById('demo-playbook-widget')?.firstElementChild?.lastElementChild;
    if (!body) return;
    if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        if (header) header.innerText = 'Minimize';
    } else {
        body.classList.add('hidden');
        if (header) header.innerText = 'Expand';
    }
}

// ==========================================
// FORECAST CONFIDENCE INDICATOR (Requirement 2)
// ==========================================

function updateForecastConfidenceUI(baseline) {
    if (!baseline) return;
    const dataQuality = Number(baseline.data_quality ?? baseline.dataQuality ?? 100);
    const missingInvoices = baseline.missing_date_invoices || baseline.missingDateInvoices || [];
    const missingCount = missingInvoices.length;

    let confidence = 'High';
    let badgeClass = 'px-3 py-1 bg-green-50 text-healthy border border-green-200 rounded-lg text-xs font-extrabold w-fit';

    if (missingCount > 0 || dataQuality < 100) {
        confidence = missingCount > 2 ? 'Low' : 'Medium';
        badgeClass = missingCount > 2
            ? 'px-3 py-1 bg-red-50 text-critical border border-red-200 rounded-lg text-xs font-extrabold w-fit'
            : 'px-3 py-1 bg-amber-50 text-attention border border-amber-200 rounded-lg text-xs font-extrabold w-fit';
    }

    // Dashboard Confidence Widget
    const dashBadge = document.getElementById('dash-confidence-badge');
    if (dashBadge) {
        dashBadge.innerText = `Forecast Confidence: ${confidence}`;
        dashBadge.className = badgeClass;
    }

    const dashFactors = document.getElementById('dash-confidence-factors');
    if (dashFactors) {
        dashFactors.innerHTML = `
            <div class="flex items-center space-x-1.5 ${dataQuality === 100 ? 'text-healthy' : 'text-attention font-bold'}">
                <span>${dataQuality === 100 ? '✓' : '⚠'}</span>
                <span>${dataQuality}% Data completeness (${missingCount === 0 ? 'All records verified' : `${missingCount} missing dates`})</span>
            </div>
            <div class="flex items-center space-x-1.5 text-healthy">
                <span>✓</span>
                <span>Recent transaction history active (Sept 2026 balance: ₹5,20,000)</span>
            </div>
            <div class="flex items-center space-x-1.5 ${missingCount === 0 ? 'text-healthy' : 'text-attention font-bold'}">
                <span>${missingCount === 0 ? '✓' : '⚠'}</span>
                <span>${missingCount === 0 ? 'All invoices have verified expected payment dates' : `${missingCount} invoice expected dates require review`}</span>
            </div>
            <div class="flex items-center space-x-1.5 text-healthy">
                <span>✓</span>
                <span>24-month payment history active for major counterparties</span>
            </div>
        `;
    }

    // Digital Twin Confidence Panel
    const twinBadge = document.getElementById('twin-confidence-badge');
    if (twinBadge) {
        twinBadge.innerText = `Forecast Confidence: ${confidence}`;
        twinBadge.className = badgeClass;
    }

    const twinFactCompleteness = document.getElementById('twin-fact-completeness');
    if (twinFactCompleteness) {
        twinFactCompleteness.innerText = `${dataQuality}% Data Completeness`;
        twinFactCompleteness.className = dataQuality === 100
            ? 'text-[10px] font-bold px-2 py-0.5 rounded bg-green-50 text-healthy border border-green-200'
            : 'text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-attention border border-amber-200';
    }

    const twinFactMissing = document.getElementById('twin-fact-missing');
    if (twinFactMissing) {
        twinFactMissing.innerText = missingCount === 0 ? 'All Expected Dates Verified' : `${missingCount} Invoices Missing Dates`;
        twinFactMissing.className = missingCount === 0
            ? 'text-[10px] font-bold px-2 py-0.5 rounded bg-green-50 text-healthy border border-green-200'
            : 'text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-attention border border-amber-200';
    }
}

// ==========================================
// CUSTOMER-WISE RISK MATRIX (Requirement 3)
// ==========================================

function renderCustomerRiskTable() {
    const tbody = document.getElementById('customer-risk-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const customerMap = {};
    let totalAR = 0;

    invoices.forEach(inv => {
        const cust = inv.customer || 'Unknown';
        const amt = Number(inv.amount) || 0;
        totalAR += amt;
        if (!customerMap[cust]) {
            customerMap[cust] = {
                name: cust,
                totalReceivables: 0,
                invoices: [],
                delays: [],
                concentrationRisk: (inv.concentration_risk || 'Medium').toUpperCase()
            };
        }
        customerMap[cust].totalReceivables += amt;
        customerMap[cust].invoices.push(inv);
        if (inv.delay_days !== null && inv.delay_days !== undefined) {
            customerMap[cust].delays.push(Number(inv.delay_days));
        }
    });

    const customers = Object.values(customerMap);
    if (customers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-4 text-center text-text-secondary">No customer data recorded.</td></tr>';
        return;
    }

    customers.forEach(c => {
        const count = c.invoices.length;
        const avgDelay = c.delays.length > 0 ? Math.round(c.delays.reduce((a, b) => a + b, 0) / c.delays.length) : 0;
        const concPct = totalAR > 0 ? Math.round((c.totalReceivables / totalAR) * 100) : 0;

        let riskRating = 'LOW';
        let badgeClass = 'bg-green-50 text-healthy border border-green-200';
        let trendProfile = 'Stable Terms Adherence';

        if (concPct >= 50 || avgDelay >= 14) {
            riskRating = 'HIGH';
            badgeClass = 'bg-red-50 text-critical border border-red-200';
            trendProfile = 'High Delay Tendency';
        } else if (concPct >= 25 || avgDelay >= 7) {
            riskRating = 'MEDIUM';
            badgeClass = 'bg-amber-50 text-attention border border-amber-200';
            trendProfile = 'Moderate Delay Profile';
        }

        const row = `
            <tr class="hover:bg-[#FFFDF9]/60 transition-colors">
                <td class="px-3.5 py-3 font-bold text-text-primary flex items-center space-x-2">
                    <span class="w-2 h-2 rounded-full ${riskRating === 'HIGH' ? 'bg-critical' : (riskRating === 'MEDIUM' ? 'bg-attention' : 'bg-healthy')}"></span>
                    <span>${c.name}</span>
                </td>
                <td class="px-3.5 py-3 font-bold text-text-primary">₹${c.totalReceivables.toLocaleString('en-IN')}</td>
                <td class="px-3.5 py-3 font-semibold text-text-secondary">${count} invoice${count > 1 ? 's' : ''}</td>
                <td class="px-3.5 py-3 font-mono font-bold ${avgDelay >= 14 ? 'text-critical' : (avgDelay >= 7 ? 'text-attention' : 'text-healthy')}">+${avgDelay} days</td>
                <td class="px-3.5 py-3 text-text-secondary text-[11px]">${trendProfile}</td>
                <td class="px-3.5 py-3 font-bold text-text-primary">${concPct}% of AR</td>
                <td class="px-3.5 py-3">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase ${badgeClass}">
                        ${riskRating}
                    </span>
                </td>
                <td class="px-3.5 py-3 text-right">
                    <button type="button" onclick="openCustomerEvidenceModal('${c.name.replace(/'/g, "\\'")}')"
                        class="px-2.5 py-1 bg-orange-50 hover:bg-orange-100 text-primary border border-primary/20 rounded-lg text-xs font-bold transition-all cursor-pointer">
                        🔍 View Trace
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function openCustomerEvidenceModal(custName) {
    const modal = document.getElementById('customer-evidence-modal');
    const titleEl = document.getElementById('cust-modal-title');
    const subEl = document.getElementById('cust-modal-sub');
    const statsEl = document.getElementById('cust-modal-stats');
    const invoicesEl = document.getElementById('cust-modal-invoices');
    const historyEl = document.getElementById('cust-modal-history');

    if (!modal) return;

    const custInvoices = invoices.filter(inv => (inv.customer || '').toLowerCase() === custName.toLowerCase());
    const totalAmt = custInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const delays = custInvoices.map(i => Number(i.delay_days) || 0);
    const avgDelay = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;

    if (titleEl) titleEl.innerText = `${custName} — Risk Evidence Traceability`;
    if (subEl) subEl.innerText = `${custInvoices.length} active invoices totaling ₹${totalAmt.toLocaleString('en-IN')}`;

    if (statsEl) {
        statsEl.innerHTML = `
            <div class="p-2.5 bg-background border border-border rounded-xl">
                <span class="text-[10px] font-bold text-text-secondary uppercase block">Total Receivables</span>
                <span class="text-sm font-black text-text-primary">₹${totalAmt.toLocaleString('en-IN')}</span>
            </div>
            <div class="p-2.5 bg-background border border-border rounded-xl">
                <span class="text-[10px] font-bold text-text-secondary uppercase block">Average Terms Delay</span>
                <span class="text-sm font-black ${avgDelay >= 14 ? 'text-critical' : 'text-attention'}">+${avgDelay} Days</span>
            </div>
            <div class="p-2.5 bg-background border border-border rounded-xl">
                <span class="text-[10px] font-bold text-text-secondary uppercase block">Underlying Invoices</span>
                <span class="text-sm font-black text-text-primary">${custInvoices.length} Records</span>
            </div>
        `;
    }

    if (invoicesEl) {
        invoicesEl.innerHTML = '';
        if (custInvoices.length === 0) {
            invoicesEl.innerHTML = '<p class="text-[11px] text-text-secondary italic">No active invoices found.</p>';
        } else {
            custInvoices.forEach(inv => {
                const card = `
                    <div class="p-3 bg-background border border-border rounded-xl flex items-center justify-between text-xs">
                        <div>
                            <div class="flex items-center space-x-2">
                                <span class="font-mono font-bold text-primary">${inv.id}</span>
                                <span class="font-bold text-text-primary">₹${Number(inv.amount).toLocaleString('en-IN')}</span>
                                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${inv.status === 'Verified' ? 'bg-green-50 text-healthy border border-green-200' : 'bg-amber-50 text-attention border border-amber-200'}">${inv.status || 'Pending'}</span>
                            </div>
                            <p class="text-[10px] text-text-secondary mt-0.5">
                                Due: <span class="font-mono font-semibold">${inv.due_date || '-'}</span> | 
                                Expected: <span class="font-mono font-semibold">${inv.expected_date || '⚠️ Unverified'}</span>
                            </p>
                        </div>
                        <span class="text-xs font-mono font-bold ${Number(inv.delay_days) >= 14 ? 'text-critical' : 'text-attention'}">+${inv.delay_days || 0}d delay</span>
                    </div>
                `;
                invoicesEl.innerHTML += card;
            });
        }
    }

    if (historyEl) {
        historyEl.innerHTML = `
            <p class="font-bold text-text-primary">Historical Behavioral Ledger Analysis:</p>
            <p class="text-text-secondary leading-relaxed">
                24-month counterparty payment history shows ${custName} settles receivables with an average delay of <strong>+${avgDelay} days</strong> past contractual payment terms. This behavioral pattern is directly factored into the cash flow twin's projected liquidity window.
            </p>
        `;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.style.display = 'flex';
}

function closeCustomerEvidenceModal() {
    const modal = document.getElementById('customer-evidence-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

// ==========================================
// EXCEL GUIDE MODAL (Requirement 1)
// ==========================================

function openExcelGuideModal() {
    const modal = document.getElementById('excel-guide-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function closeExcelGuideModal() {
    const modal = document.getElementById('excel-guide-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

// ==========================================
// APP MANUAL ENTRY MODAL (Requirement 6)
// ==========================================

function openAppManualEntryModal() {
    const modal = document.getElementById('app-manual-entry-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function closeAppManualEntryModal() {
    const modal = document.getElementById('app-manual-entry-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

function switchAppManualTab(tab) {
    const tabs = ['inv', 'exp', 'pay', 'bnk'];
    tabs.forEach(t => {
        const btn = document.getElementById(`app-mtab-${t}`);
        const form = document.getElementById(`app-mform-${t}`);
        if (btn && form) {
            if (t === tab) {
                btn.className = 'px-3 py-1.5 bg-primary text-white rounded-lg font-bold text-xs shrink-0 cursor-pointer';
                form.classList.remove('hidden');
            } else {
                btn.className = 'px-3 py-1.5 bg-white text-text-secondary border border-border rounded-lg font-bold text-xs shrink-0 cursor-pointer';
                form.classList.add('hidden');
            }
        }
    });
}

function submitAppManualInvoice() {
    const id = (document.getElementById('app-minv-id')?.value || '').trim();
    const customer = (document.getElementById('app-minv-customer')?.value || '').trim();
    const amount = parseFloat(document.getElementById('app-minv-amount')?.value) || 0;
    const conc = document.getElementById('app-minv-concentration')?.value || 'Medium';
    const due = document.getElementById('app-minv-due')?.value || '';
    const exp = document.getElementById('app-minv-exp')?.value || null;

    if (!id || !customer || amount <= 0 || !due) {
        showToast('Please fill all required invoice fields.', 'error');
        return;
    }

    const payload = {
        invoice_id: id,
        customer: customer,
        amount: amount,
        due_date: due,
        expected_date: exp,
        concentration_risk: conc.toUpperCase(),
        status: exp ? 'Verified' : 'Pending'
    };

    fetch('/api/invoices/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            invoices.unshift(data.invoice || payload);
            closeAppManualEntryModal();
            renderInvoicesTable();
            triggerForecastRecalculation();
            showToast(`✓ Invoice ${id} created successfully.`, 'success');
        } else {
            showToast(data.error || 'Failed to create invoice.', 'error');
        }
    })
    .catch(err => {
        invoices.unshift({ ...payload, id: id, delay_days: calculateDelayDays(due, exp) });
        closeAppManualEntryModal();
        renderInvoicesTable();
        recalculateEngine();
        showToast(`✓ Invoice ${id} created locally.`, 'success');
    });
}

function submitAppManualExpense() {
    const id = (document.getElementById('app-mexp-id')?.value || '').trim();
    const payee = (document.getElementById('app-mexp-payee')?.value || '').trim();
    const cat = document.getElementById('app-mexp-cat')?.value || 'Raw Materials';
    const amount = parseFloat(document.getElementById('app-mexp-amount')?.value) || 0;
    const due = document.getElementById('app-mexp-due')?.value || '';

    if (!id || !payee || amount <= 0 || !due) {
        showToast('Please fill all required expense fields.', 'error');
        return;
    }

    const payload = {
        expense_id: id,
        payee: payee,
        category: cat,
        amount: amount,
        due_date: due,
        status: 'Upcoming'
    };

    fetch('/api/expenses/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            expenses.unshift(data.expense || payload);
            closeAppManualEntryModal();
            renderExpensesTable();
            triggerForecastRecalculation();
            showToast(`✓ Expense ${id} created successfully.`, 'success');
        } else {
            showToast(data.error || 'Failed to create expense.', 'error');
        }
    })
    .catch(err => {
        expenses.unshift({ ...payload, id: id });
        closeAppManualEntryModal();
        renderExpensesTable();
        recalculateEngine();
        showToast(`✓ Expense ${id} created locally.`, 'success');
    });
}

function submitAppManualPayment() {
    const cust = (document.getElementById('app-mpay-customer')?.value || '').trim();
    const delay = parseInt(document.getElementById('app-mpay-delay')?.value) || 0;
    if (!cust) {
        showToast('Please enter customer name.', 'error');
        return;
    }

    const payload = {
        customer: cust,
        avg_delay_days: delay,
        payment_behavior: delay > 10 ? 'High Delay Tendency' : (delay > 5 ? 'Stable Terms Adherence' : 'Prompt Payment'),
        risk_rating: delay > 12 ? 'HIGH' : (delay > 6 ? 'MEDIUM' : 'LOW')
    };

    fetch('/api/payment-history/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        closeAppManualEntryModal();
        if (data.success && data.baseline) {
            applyBaselineToAllScreens(data.baseline, new Date().toLocaleString('en-IN'));
        } else {
            triggerForecastRecalculation();
        }
        addAuditEntry('User (finance@abcmfg.in)', `Recorded payment history profile for ${cust} (Avg Delay: +${delay}d)`);
        showToast(`✓ Payment profile for ${cust} saved in database.`, 'success');
    })
    .catch(err => {
        closeAppManualEntryModal();
        recalculateEngine();
        showToast(`✓ Payment profile for ${cust} saved locally.`, 'success');
    });
}

function submitAppManualBank() {
    const desc = (document.getElementById('app-mbnk-desc')?.value || '').trim();
    const tDate = document.getElementById('app-mbnk-date')?.value || new Date().toISOString().split('T')[0];
    const credit = parseFloat(document.getElementById('app-mbnk-credit')?.value) || 0;
    const debit = parseFloat(document.getElementById('app-mbnk-debit')?.value) || 0;

    if (!desc || (credit === 0 && debit === 0)) {
        showToast('Please enter transaction description and at least one credit or debit amount.', 'error');
        return;
    }

    const currentBal = (currentBaseline && currentBaseline.current_cash) ? currentBaseline.current_cash : 520000;
    const newBal = currentBal + credit - debit;

    const payload = {
        description: desc,
        transaction_date: tDate,
        credit_amount: credit,
        debit_amount: debit,
        running_balance: newBal
    };

    fetch('/api/bank-transactions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        closeAppManualEntryModal();
        if (data.success && data.baseline) {
            applyBaselineToAllScreens(data.baseline, new Date().toLocaleString('en-IN'));
        } else {
            triggerForecastRecalculation();
        }
        addAuditEntry('User (finance@abcmfg.in)', `Recorded bank transaction: ${desc}`);
        showToast(`✓ Bank transaction recorded and cash balance updated.`, 'success');
    })
    .catch(err => {
        closeAppManualEntryModal();
        recalculateEngine();
        showToast(`✓ Bank transaction recorded locally.`, 'success');
    });
}

// ==========================================
// DATA REVIEW FULL EDIT (Requirement 7)
// ==========================================

function openDataReviewEditModal(recId) {
    const inv = invoices.find(i => i.id === recId);
    if (!inv) return;

    document.getElementById('dr-edit-id').value = inv.id;
    document.getElementById('dr-edit-customer').value = inv.customer || '';
    document.getElementById('dr-edit-amount').value = inv.amount || '';
    document.getElementById('dr-edit-status').value = inv.status || 'Pending';
    document.getElementById('dr-edit-due-date').value = inv.due_date || '';
    document.getElementById('dr-edit-expected-date').value = inv.expected_date || '';

    const modal = document.getElementById('datareview-edit-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.style.display = 'flex';
    }
}

function closeDataReviewEditModal() {
    const modal = document.getElementById('datareview-edit-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.style.display = 'none';
    }
}

function handleSaveDataReviewEdit(e) {
    if (e && e.preventDefault) e.preventDefault();

    const invId = document.getElementById('dr-edit-id')?.value;
    const customer = document.getElementById('dr-edit-customer')?.value;
    const amount = parseFloat(document.getElementById('dr-edit-amount')?.value) || 0;
    const status = document.getElementById('dr-edit-status')?.value || 'Pending';
    const dueDate = document.getElementById('dr-edit-due-date')?.value || '';
    const expectedDate = document.getElementById('dr-edit-expected-date')?.value || null;

    if (!customer || amount <= 0 || !dueDate) {
        showToast('Please fill all required fields.', 'error');
        return;
    }

    const payload = {
        customer: customer,
        amount: amount,
        status: status,
        due_date: dueDate,
        expected_date: expectedDate
    };

    fetch(`/api/invoices/${encodeURIComponent(invId)}/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            const idx = invoices.findIndex(i => i.id === invId);
            if (idx !== -1) {
                invoices[idx] = { ...invoices[idx], ...payload, delay_days: calculateDelayDays(dueDate, expectedDate) };
            }
            closeDataReviewEditModal();
            renderInvoicesTable();
            triggerForecastRecalculation();
            showToast(`✓ Record ${invId} updated & Forecast recalculated`, 'success');
        } else {
            showToast(data.error || 'Failed to update record.', 'error');
        }
    })
    .catch(err => {
        console.error('Edit error:', err);
        const idx = invoices.findIndex(i => i.id === invId);
        if (idx !== -1) {
            invoices[idx] = { ...invoices[idx], ...payload, delay_days: calculateDelayDays(dueDate, expectedDate) };
        }
        closeDataReviewEditModal();
        renderInvoicesTable();
        recalculateEngine();
        showToast(`✓ Record ${invId} updated locally & Forecast recalculated`, 'success');
    });
}

// Expose functions globally on window object to guarantee inline onclick execution
window.openAddInvoiceModal = openAddInvoiceModal;
window.openEditInvoiceModal = openEditInvoiceModal;
window.closeInvoiceModal = closeInvoiceModal;
window.handleSaveInvoice = handleSaveInvoice;
window.confirmDeleteInvoice = confirmDeleteInvoice;
window.closeDeleteModal = closeDeleteModal;
window.executeDeleteInvoice = executeDeleteInvoice;

window.openAddExpenseModal = openAddExpenseModal;
window.openEditExpenseModal = openEditExpenseModal;
window.closeExpenseModal = closeExpenseModal;
window.handleSaveExpense = handleSaveExpense;
window.confirmDeleteExpense = confirmDeleteExpense;
window.closeDeleteExpenseModal = closeDeleteExpenseModal;
window.executeDeleteExpense = executeDeleteExpense;

window.openUserCorrectionModal = openUserCorrectionModal;
window.closeUserCorrectionModal = closeUserCorrectionModal;
window.handleSaveUserCorrection = handleSaveUserCorrection;
window.calculateCorrectionDelay = calculateCorrectionDelay;
window.saveDirectInvoiceCorrection = saveDirectInvoiceCorrection;
window.triggerForecastRecalculation = triggerForecastRecalculation;

window.updateForecastConfidenceUI = updateForecastConfidenceUI;
window.renderCustomerRiskTable = renderCustomerRiskTable;
window.openCustomerEvidenceModal = openCustomerEvidenceModal;
window.closeCustomerEvidenceModal = closeCustomerEvidenceModal;

window.openExcelGuideModal = openExcelGuideModal;
window.closeExcelGuideModal = closeExcelGuideModal;
window.openAppManualEntryModal = openAppManualEntryModal;
window.closeAppManualEntryModal = closeAppManualEntryModal;
window.switchAppManualTab = switchAppManualTab;
window.submitAppManualInvoice = submitAppManualInvoice;
window.submitAppManualExpense = submitAppManualExpense;
window.submitAppManualPayment = submitAppManualPayment;
window.submitAppManualBank = submitAppManualBank;

window.openDataReviewEditModal = openDataReviewEditModal;
window.closeDataReviewEditModal = closeDataReviewEditModal;
window.handleSaveDataReviewEdit = handleSaveDataReviewEdit;

window.toggleUserMenu = toggleUserMenu;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.handleLogout = handleLogout;
window.switchScreen = switchScreen;
window.runSimulation = runSimulation;
window.updateSimValueDisplay = updateSimValueDisplay;
window.selectResilienceOption = selectResilienceOption;
window.resetDemoFlow = resetDemoFlow;
window.togglePlaybook = togglePlaybook;
window.calculateDelayFromForm = calculateDelayFromForm;
