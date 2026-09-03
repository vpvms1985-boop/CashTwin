import datetime
from decimal import Decimal
from typing import Dict, Any, List, Optional


def format_pretty_date(date_str: Optional[str]) -> str:
    if not date_str:
        return "No Deficit"
    try:
        if isinstance(date_str, datetime.date):
            d = date_str
        else:
            d = datetime.datetime.strptime(str(date_str).strip(), "%Y-%m-%d").date()
        months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ]
        return f"{d.day} {months[d.month - 1]}"
    except Exception:
        return str(date_str)


def calculate_forecast(
    cash_balance: Optional[float] = None,
    safe_threshold: float = 150000.0,
    invoices_list: Optional[List[Dict[str, Any]]] = None,
    expenses_list: Optional[List[Dict[str, Any]]] = None,
    payment_history_list: Optional[List[Dict[str, Any]]] = None,
    bank_transactions_list: Optional[List[Dict[str, Any]]] = None,
    scenario_modifiers: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Authoritative deterministic cash-flow ledger simulation engine.
    Computes cash trajectories, minimum cash dips, liquidity gap,
    customer concentration, and data quality scores strictly from user-provided data.
    """
    from .models import Invoice, Expense, PaymentHistory, BankTransaction

    # 1. Fetch from DB if not passed
    if invoices_list is None:
        invoices_list = [inv.to_dict() for inv in Invoice.objects.all()]
    if expenses_list is None:
        expenses_list = [exp.to_dict() for exp in Expense.objects.all()]
    if payment_history_list is None:
        payment_history_list = [ph.to_dict() for ph in PaymentHistory.objects.all()]
    if bank_transactions_list is None:
        bank_transactions_list = [bt.to_dict() for bt in BankTransaction.objects.all()]

    total_records = len(invoices_list) + len(expenses_list) + len(payment_history_list) + len(bank_transactions_list)

    # 2. Check for Zero-Data Empty State
    if total_records == 0:
        return {
            'has_data': False,
            'current_cash': 0.0,
            'safe_threshold': float(safe_threshold),
            'total_receivables': 0.0,
            'pending_invoice_count': 0,
            'total_expenses': 0.0,
            'upcoming_expense_count': 0,
            'projected_min_cash': 0.0,
            'min_cash_date': None,
            'pretty_min_cash_date': 'No Data',
            'liquidity_gap': 0.0,
            'has_liquidity_gap': False,
            'gap_date': None,
            'pretty_gap_date': 'No Deficit',
            'forecast_status': 'NO_DATA',
            'forecast_status_display': 'No Financial Data Available',
            'data_quality': 0,
            'confidence_level': 'None',
            'confidence_factors': [
                {
                    'label': '0 Financial Records Available',
                    'status': 'warning',
                    'detail': 'Add invoices, expenses, or bank records to generate forecasts.'
                },
                {
                    'label': 'Bank Ledger Disconnected',
                    'status': 'warning',
                    'detail': 'Record opening bank balance or sync statements.'
                },
                {
                    'label': 'No Counterparty History',
                    'status': 'warning',
                    'detail': 'Payment delay and concentration models require invoices.'
                }
            ],
            'missing_date_invoices': [],
            'missing_count': 0,
            'top_customer': 'None',
            'top_customer_amount': 0.0,
            'top_concentration_pct': 0,
            'top_concentration_risk': 'NONE',
            'customer_delays': {},
            'top_delayed_invoice': None,
            'timeline_points': [],
            'invoices': [],
            'expenses': [],
            'payment_history': [],
            'bank_transactions': [],
        }

    # 3. Determine Starting Cash Position
    if cash_balance is None:
        if bank_transactions_list:
            latest_txn = bank_transactions_list[0]
            cash_balance = float(latest_txn.get('running_balance', 0.0) or 0.0)
        else:
            cash_balance = 0.0

    active_invoices = [
        inv for inv in invoices_list
        if inv.get('status') in ['Pending', 'Overdue', 'Verified', 'Needs Review']
    ]
    active_expenses = [
        exp for exp in expenses_list
        if exp.get('status') in ['Upcoming', 'Pending']
    ]

    # 4. Data Quality & Forecast Confidence Audit
    missing_date_invoices = [
        inv for inv in active_invoices
        if not inv.get('expected_date')
    ]
    missing_count = len(missing_date_invoices)
    
    if len(active_invoices) > 0:
        data_quality = 100 if missing_count == 0 else max(40, 100 - (missing_count * 15))
    else:
        data_quality = 100 if len(active_expenses) > 0 else 50

    if missing_count == 0 and data_quality >= 90 and (len(payment_history_list) > 0 or len(bank_transactions_list) > 0):
        confidence_level = 'High'
    elif missing_count <= 2 and data_quality >= 70:
        confidence_level = 'Medium'
    else:
        confidence_level = 'Low'

    confidence_factors = [
        {
            'label': f"{data_quality}% Data Completeness Quality",
            'status': 'positive' if data_quality == 100 else 'warning',
            'detail': 'All active records verified' if missing_count == 0 else f"{missing_count} invoices missing expected dates"
        },
        {
            'label': f"Bank Ledger Tracking (Balance: ₹{int(cash_balance):,})",
            'status': 'positive' if len(bank_transactions_list) > 0 else 'warning',
            'detail': f"{len(bank_transactions_list)} bank transactions synchronized" if len(bank_transactions_list) > 0 else "No bank transactions recorded"
        },
        {
            'label': "Counterparty Risk & History",
            'status': 'positive' if len(payment_history_list) > 0 or len(invoices_list) > 0 else 'warning',
            'detail': f"{len(payment_history_list)} counterparty historical profiles active" if len(payment_history_list) > 0 else "Derived from entered invoice delay records"
        },
        {
            'label': "Expected Payment Date Verification",
            'status': 'positive' if missing_count == 0 else 'warning',
            'detail': 'All active invoices have verified expected dates' if missing_count == 0 else f"{missing_count} invoices require expected date resolution"
        }
    ]

    # 5. Timeline Events Aggregation
    timeline_events = []
    total_expenses = 0.0
    total_receivables = 0.0

    # Process Expenses
    today_str = datetime.date.today().strftime('%Y-%m-%d')
    for exp in active_expenses:
        amount = float(exp.get('amount') or 0.0)
        total_expenses += amount
        due_date_str = str(exp.get('due_date') or today_str)
        timeline_events.append({
            'date': due_date_str,
            'type': 'expense',
            'amount': amount,
            'id': exp.get('id') or exp.get('expense_id'),
            'desc': exp.get('payee', 'Expense Outflow')
        })

    # Optional unexpected expense scenario modifier
    if scenario_modifiers and float(scenario_modifiers.get('unexpectedExpenses', 0.0)) > 0:
        unexp_amt = float(scenario_modifiers['unexpectedExpenses'])
        total_expenses += unexp_amt
        timeline_events.append({
            'date': today_str,
            'type': 'expense',
            'amount': unexp_amt,
            'id': 'SCENARIO-EXP',
            'desc': 'Unexpected Contingency Outflow'
        })

    # Process Invoices
    customer_totals: Dict[str, float] = {}
    customer_delays: Dict[str, Dict[str, Any]] = {}

    sales_volume_pct = float(scenario_modifiers.get('salesVolumePct', 0.0)) if scenario_modifiers else 0.0
    extra_delay_days = int(scenario_modifiers.get('extraDelayDays', 0)) if scenario_modifiers else 0
    target_customer = (scenario_modifiers.get('targetCustomer') or '').lower() if scenario_modifiers else ''

    for inv in active_invoices:
        amount = float(inv.get('amount') or 0.0)
        if sales_volume_pct != 0:
            factor = 1.0 + (sales_volume_pct / 100.0)
            amount = round(amount * factor, 2)

        total_receivables += amount

        cust = str(inv.get('customer') or 'Unknown').strip()
        customer_totals[cust] = customer_totals.get(cust, 0.0) + amount

        # Arrival Date resolution
        expected_date = inv.get('expected_date')
        due_date = inv.get('due_date')
        arrival_date_str = str(expected_date if expected_date else (due_date or today_str))

        if extra_delay_days > 0:
            is_target = (not target_customer) or (target_customer in cust.lower())
            if is_target:
                try:
                    d = datetime.datetime.strptime(arrival_date_str, '%Y-%m-%d').date()
                    d = d + datetime.timedelta(days=extra_delay_days)
                    arrival_date_str = d.strftime('%Y-%m-%d')
                except Exception:
                    pass

        timeline_events.append({
            'date': arrival_date_str,
            'type': 'receivable',
            'amount': amount,
            'id': inv.get('id') or inv.get('invoice_id'),
            'desc': f"{cust} ({inv.get('id') or inv.get('invoice_id')})"
        })

    # Delay statistics per customer (combine invoices + PaymentHistory table)
    for inv in invoices_list:
        cust = str(inv.get('customer') or 'Unknown').strip()
        if cust not in customer_delays:
            customer_delays[cust] = {'total_delay': 0, 'count': 0, 'avg_delay': 0}
        delay = inv.get('delay_days')
        if delay is not None and str(delay) != '':
            try:
                delay_num = int(delay)
                customer_delays[cust]['total_delay'] += delay_num
                customer_delays[cust]['count'] += 1
            except (ValueError, TypeError):
                pass

    # Incorporate payment history defaults if invoice counts are 0
    for ph in payment_history_list:
        cust = str(ph.get('customer') or 'Unknown').strip()
        if cust not in customer_delays or customer_delays[cust]['count'] == 0:
            customer_delays[cust] = {
                'total_delay': ph.get('avg_delay_days', 0),
                'count': 1,
                'avg_delay': ph.get('avg_delay_days', 0)
            }

    for cust, stats in customer_delays.items():
        if stats['count'] > 0:
            stats['avg_delay'] = round(stats['total_delay'] / stats['count'])

    # Concentration Analysis
    top_customer = 'None'
    top_customer_amount = 0.0
    for cust, c_total in customer_totals.items():
        if c_total > top_customer_amount:
            top_customer_amount = c_total
            top_customer = cust

    top_concentration_pct = round((top_customer_amount / total_receivables * 100)) if total_receivables > 0 else 0
    if top_concentration_pct >= 50:
        top_concentration_risk = 'HIGH'
    elif top_concentration_pct >= 25:
        top_concentration_risk = 'MEDIUM'
    elif top_concentration_pct > 0:
        top_concentration_risk = 'LOW'
    else:
        top_concentration_risk = 'NONE'

    # Top delayed invoice for risk evidence trace
    top_delayed_invoice = None
    max_delay = -999
    for inv in active_invoices:
        delay = inv.get('delay_days')
        if delay is not None:
            try:
                d_num = int(delay)
                if d_num > max_delay:
                    max_delay = d_num
                    top_delayed_invoice = inv
            except (ValueError, TypeError):
                pass
    if not top_delayed_invoice and active_invoices:
        top_delayed_invoice = active_invoices[0]

    # 6. Chronological Ledger Simulation
    timeline_events.sort(key=lambda e: e['date'])

    running_cash = cash_balance
    min_cash = cash_balance
    min_cash_date = timeline_events[0]['date'] if timeline_events else today_str

    timeline_points = []
    timeline_points.append({
        'date': 'Start',
        'balance': running_cash,
        'change': 0,
        'desc': 'Starting Bank Balance'
    })

    for evt in timeline_events:
        if evt['type'] == 'expense':
            running_cash -= evt['amount']
            change = -evt['amount']
        else:
            running_cash += evt['amount']
            change = evt['amount']

        timeline_points.append({
            'date': evt['date'],
            'balance': round(running_cash, 2),
            'change': round(change, 2),
            'desc': evt['desc'],
            'type': evt['type']
        })

        if running_cash < min_cash:
            min_cash = running_cash
            min_cash_date = evt['date']

    # 7. Liquidity Gap & Status Assessment
    min_cash = round(min_cash, 2)
    if min_cash < safe_threshold and (total_expenses > 0 or total_receivables > 0 or len(bank_transactions_list) > 0):
        liquidity_gap = round(safe_threshold - min_cash, 2)
        has_liquidity_gap = True
        gap_date = min_cash_date
        pretty_gap_date = format_pretty_date(min_cash_date)
        if liquidity_gap >= 300000:
            forecast_status = 'CRITICAL_DEFICIT'
            forecast_status_display = 'Critical Deficit Risk'
        else:
            forecast_status = 'DEFICIT_RISK'
            forecast_status_display = 'Projected Liquidity Gap'
    else:
        liquidity_gap = 0.0
        has_liquidity_gap = False
        gap_date = None
        pretty_gap_date = 'No Deficit'
        forecast_status = 'HEALTHY'
        forecast_status_display = 'Healthy / Safe Liquidity'

    return {
        'has_data': True,
        'current_cash': float(cash_balance),
        'safe_threshold': float(safe_threshold),
        'total_receivables': float(total_receivables),
        'pending_invoice_count': len(active_invoices),
        'total_expenses': float(total_expenses),
        'upcoming_expense_count': len(active_expenses),
        'projected_min_cash': float(min_cash),
        'min_cash_date': min_cash_date,
        'pretty_min_cash_date': format_pretty_date(min_cash_date),
        'liquidity_gap': float(liquidity_gap),
        'has_liquidity_gap': has_liquidity_gap,
        'gap_date': gap_date,
        'pretty_gap_date': pretty_gap_date,
        'forecast_status': forecast_status,
        'forecast_status_display': forecast_status_display,
        'data_quality': data_quality,
        'confidence_level': confidence_level,
        'confidence_factors': confidence_factors,
        'missing_date_invoices': missing_date_invoices,
        'missing_count': missing_count,
        'top_customer': top_customer,
        'top_customer_amount': float(top_customer_amount),
        'top_concentration_pct': top_concentration_pct,
        'top_concentration_risk': top_concentration_risk,
        'customer_delays': customer_delays,
        'top_delayed_invoice': top_delayed_invoice,
        'timeline_points': timeline_points,
        'invoices': invoices_list,
        'expenses': expenses_list,
        'payment_history': payment_history_list,
        'bank_transactions': bank_transactions_list,
    }

