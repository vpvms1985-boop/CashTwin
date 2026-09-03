import json
import csv
import io
from decimal import Decimal
from datetime import datetime, date
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.http import JsonResponse, HttpResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from .models import Invoice, Expense, PaymentHistory, BankTransaction
from .forecast import calculate_forecast


def landing(request):
    return render(request, 'core/landing.html')


def auth_flow(request):
    if request.method == 'POST':
        request.session['is_authenticated'] = True
        
        # Save registered business identity in session
        biz_name = request.POST.get('business_name', '').strip()
        email = request.POST.get('email', '').strip()
        if biz_name:
            request.session['business_name'] = biz_name
        if email:
            request.session['user_email'] = email

        return redirect(f"{reverse('core:app_dashboard')}?consented=true")

    if request.GET.get('demo') == 'quick' or request.GET.get('consented') == 'true' or request.GET.get('login') == 'true':
        request.session['is_authenticated'] = True
        return redirect('core:app_dashboard')

    return render(request, 'core/auth_flow.html')


def logout_view(request):
    request.session.flush()
    response = redirect(f"{reverse('core:auth_flow')}?action=login&logged_out=true")
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    return response


@never_cache
@ensure_csrf_cookie
def app_dashboard(request):
    if request.GET.get('demo') == 'quick' or request.GET.get('consented') == 'true':
        request.session['is_authenticated'] = True

    if not request.session.get('is_authenticated', False):
        return redirect(f"{reverse('core:auth_flow')}?action=login")

    company_name = request.session.get('business_name') or 'My Business Workspace'
    user_email = request.session.get('user_email') or 'finance@cashtwin.io'

    # Run deterministic backend forecast calculation from real database state
    forecast_baseline = calculate_forecast(safe_threshold=150000.0)
    forecast_baseline['company_name'] = company_name

    context = {
        'company_name': company_name,
        'user_email': user_email,
        'mock_data_json': json.dumps(forecast_baseline),
        'mock_data': forecast_baseline,
    }
    response = render(request, 'core/app.html', context)
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    return response


# ==========================================
# 1. INVOICE CRUD API ENDPOINTS
# ==========================================

@never_cache
def api_invoices(request):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    if request.method == 'GET':
        invoices = [inv.to_dict() for inv in Invoice.objects.all()]
        return JsonResponse({'success': True, 'invoices': invoices})

    elif request.method == 'POST':
        try:
            if request.content_type == 'application/json':
                data = json.loads(request.body.decode('utf-8'))
            else:
                data = request.POST

            invoice_id = str(data.get('invoice_id') or data.get('id') or '').strip()
            customer = str(data.get('customer') or '').strip()
            amount_val = data.get('amount')
            due_date_str = str(data.get('due_date') or '').strip()
            expected_date_str = str(data.get('expected_date') or '').strip() or None
            concentration_risk = str(data.get('concentration_risk') or 'MEDIUM').strip().upper()
            status = str(data.get('status') or ('Verified' if expected_date_str else 'Pending')).strip()

            if not invoice_id:
                return JsonResponse({'success': False, 'error': 'Invoice ID is required.'}, status=400)
            if not customer:
                return JsonResponse({'success': False, 'error': 'Customer name is required.'}, status=400)
            if not amount_val or float(amount_val) <= 0:
                return JsonResponse({'success': False, 'error': 'Amount must be greater than 0.'}, status=400)
            if not due_date_str:
                return JsonResponse({'success': False, 'error': 'Due Date is required.'}, status=400)

            if Invoice.objects.filter(invoice_id__iexact=invoice_id).exists():
                return JsonResponse({'success': False, 'error': f'Invoice with ID "{invoice_id}" already exists.'}, status=400)

            due_date = datetime.strptime(due_date_str, '%Y-%m-%d').date()
            expected_date = datetime.strptime(expected_date_str, '%Y-%m-%d').date() if expected_date_str else None

            inv = Invoice.objects.create(
                invoice_id=invoice_id,
                customer=customer,
                amount=Decimal(str(amount_val)),
                due_date=due_date,
                expected_date=expected_date,
                concentration_risk=concentration_risk,
                status=status
            )

            # Recalculate baseline forecast immediately
            baseline = calculate_forecast(safe_threshold=150000.0)

            return JsonResponse({
                'success': True,
                'message': f'Invoice {inv.invoice_id} saved successfully.',
                'invoice': inv.to_dict(),
                'baseline': baseline
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)


@never_cache
def api_invoice_detail(request, invoice_id):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    inv = get_object_or_404(Invoice, invoice_id=invoice_id)

    if request.method == 'GET':
        return JsonResponse({'success': True, 'invoice': inv.to_dict()})

    elif request.method in ['POST', 'PUT']:
        try:
            if request.content_type == 'application/json':
                data = json.loads(request.body.decode('utf-8'))
            else:
                data = request.POST

            action = data.get('action')
            if action == 'delete' or request.method == 'DELETE':
                inv_id = inv.invoice_id
                inv.delete()
                baseline = calculate_forecast(safe_threshold=150000.0)
                return JsonResponse({'success': True, 'message': f'Invoice {inv_id} deleted successfully.', 'baseline': baseline})

            if 'customer' in data and data['customer']:
                inv.customer = str(data['customer']).strip()
            if 'amount' in data and data['amount']:
                inv.amount = Decimal(str(data['amount']))
            if 'due_date' in data and data['due_date']:
                inv.due_date = datetime.strptime(str(data['due_date']).strip(), '%Y-%m-%d').date()
            if 'expected_date' in data:
                exp_str = str(data['expected_date']).strip() if data['expected_date'] else None
                inv.expected_date = datetime.strptime(exp_str, '%Y-%m-%d').date() if exp_str else None
            if 'concentration_risk' in data and data['concentration_risk']:
                inv.concentration_risk = str(data['concentration_risk']).strip().upper()
            if 'status' in data and data['status']:
                inv.status = str(data['status']).strip()

            inv.save()
            baseline = calculate_forecast(safe_threshold=150000.0)

            return JsonResponse({
                'success': True,
                'message': f'Invoice {inv.invoice_id} updated successfully.',
                'invoice': inv.to_dict(),
                'baseline': baseline
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    elif request.method == 'DELETE':
        inv_id = inv.invoice_id
        inv.delete()
        baseline = calculate_forecast(safe_threshold=150000.0)
        return JsonResponse({'success': True, 'message': f'Invoice {inv_id} deleted successfully.', 'baseline': baseline})

    return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)


# ==========================================
# 2. EXPENSE CRUD API ENDPOINTS
# ==========================================

@never_cache
def api_expenses(request):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    if request.method == 'GET':
        expenses = [exp.to_dict() for exp in Expense.objects.all()]
        return JsonResponse({'success': True, 'expenses': expenses})

    elif request.method == 'POST':
        try:
            if request.content_type == 'application/json':
                data = json.loads(request.body.decode('utf-8'))
            else:
                data = request.POST

            expense_id = str(data.get('expense_id') or data.get('id') or '').strip()
            payee = str(data.get('payee') or '').strip()
            category = str(data.get('category') or 'Raw Materials').strip()
            amount_val = data.get('amount')
            due_date_str = str(data.get('due_date') or '').strip()
            recurring = bool(data.get('recurring', False))
            status = str(data.get('status') or 'Upcoming').strip()

            if not expense_id:
                return JsonResponse({'success': False, 'error': 'Expense ID is required.'}, status=400)
            if not payee:
                return JsonResponse({'success': False, 'error': 'Payee / Vendor name is required.'}, status=400)
            if not amount_val or float(amount_val) <= 0:
                return JsonResponse({'success': False, 'error': 'Amount must be greater than 0.'}, status=400)
            if not due_date_str:
                return JsonResponse({'success': False, 'error': 'Due Date is required.'}, status=400)

            if Expense.objects.filter(expense_id__iexact=expense_id).exists():
                return JsonResponse({'success': False, 'error': f'Expense with ID "{expense_id}" already exists.'}, status=400)

            due_date = datetime.strptime(due_date_str, '%Y-%m-%d').date()

            exp = Expense.objects.create(
                expense_id=expense_id,
                payee=payee,
                category=category,
                amount=Decimal(str(amount_val)),
                due_date=due_date,
                recurring=recurring,
                status=status
            )

            baseline = calculate_forecast(safe_threshold=150000.0)

            return JsonResponse({
                'success': True,
                'message': f'Expense {exp.expense_id} saved successfully.',
                'expense': exp.to_dict(),
                'baseline': baseline
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)


@never_cache
def api_expense_detail(request, expense_id):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    exp = get_object_or_404(Expense, expense_id=expense_id)

    if request.method == 'GET':
        return JsonResponse({'success': True, 'expense': exp.to_dict()})

    elif request.method in ['POST', 'PUT']:
        try:
            if request.content_type == 'application/json':
                data = json.loads(request.body.decode('utf-8'))
            else:
                data = request.POST

            action = data.get('action')
            if action == 'delete' or request.method == 'DELETE':
                e_id = exp.expense_id
                exp.delete()
                baseline = calculate_forecast(safe_threshold=150000.0)
                return JsonResponse({'success': True, 'message': f'Expense {e_id} deleted successfully.', 'baseline': baseline})

            if 'payee' in data and data['payee']:
                exp.payee = str(data['payee']).strip()
            if 'category' in data and data['category']:
                exp.category = str(data['category']).strip()
            if 'amount' in data and data['amount']:
                exp.amount = Decimal(str(data['amount']))
            if 'due_date' in data and data['due_date']:
                exp.due_date = datetime.strptime(str(data['due_date']).strip(), '%Y-%m-%d').date()
            if 'recurring' in data:
                exp.recurring = bool(data['recurring'])
            if 'status' in data and data['status']:
                exp.status = str(data['status']).strip()

            exp.save()
            baseline = calculate_forecast(safe_threshold=150000.0)

            return JsonResponse({
                'success': True,
                'message': f'Expense {exp.expense_id} updated successfully.',
                'expense': exp.to_dict(),
                'baseline': baseline
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    elif request.method == 'DELETE':
        e_id = exp.expense_id
        exp.delete()
        baseline = calculate_forecast(safe_threshold=150000.0)
        return JsonResponse({'success': True, 'message': f'Expense {e_id} deleted successfully.', 'baseline': baseline})

    return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)


# ==========================================
# 3. PAYMENT HISTORY CRUD API ENDPOINTS
# ==========================================

@never_cache
def api_payment_history(request):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    if request.method == 'GET':
        records = [ph.to_dict() for ph in PaymentHistory.objects.all()]
        return JsonResponse({'success': True, 'payment_history': records})

    elif request.method == 'POST':
        try:
            if request.content_type == 'application/json':
                data = json.loads(request.body.decode('utf-8'))
            else:
                data = request.POST

            customer = str(data.get('customer') or '').strip()
            avg_delay = int(data.get('avg_delay_days', 0) or data.get('avg_delay', 0) or 0)
            behavior = str(data.get('payment_behavior') or 'Stable Terms Adherence').strip()
            risk = str(data.get('risk_rating') or 'LOW').strip().upper()

            if not customer:
                return JsonResponse({'success': False, 'error': 'Customer name is required.'}, status=400)

            ph, created = PaymentHistory.objects.update_or_create(
                customer=customer,
                defaults={
                    'avg_delay_days': avg_delay,
                    'payment_behavior': behavior,
                    'risk_rating': risk
                }
            )

            baseline = calculate_forecast(safe_threshold=150000.0)

            return JsonResponse({
                'success': True,
                'message': f'Payment history record for {customer} saved.',
                'payment_history': ph.to_dict(),
                'baseline': baseline
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)


@never_cache
def api_payment_history_detail(request, customer):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    ph = get_object_or_404(PaymentHistory, customer__iexact=customer)

    if request.method == 'GET':
        return JsonResponse({'success': True, 'payment_history': ph.to_dict()})

    elif request.method in ['POST', 'PUT']:
        try:
            data = json.loads(request.body.decode('utf-8')) if request.content_type == 'application/json' else request.POST
            if 'avg_delay_days' in data:
                ph.avg_delay_days = int(data['avg_delay_days'])
            if 'payment_behavior' in data:
                ph.payment_behavior = str(data['payment_behavior']).strip()
            if 'risk_rating' in data:
                ph.risk_rating = str(data['risk_rating']).strip().upper()
            ph.save()
            baseline = calculate_forecast(safe_threshold=150000.0)
            return JsonResponse({'success': True, 'payment_history': ph.to_dict(), 'baseline': baseline})
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    elif request.method == 'DELETE':
        ph.delete()
        baseline = calculate_forecast(safe_threshold=150000.0)
        return JsonResponse({'success': True, 'message': f'Record for {customer} deleted.', 'baseline': baseline})

    return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)


# ==========================================
# 4. BANK TRANSACTION CRUD API ENDPOINTS
# ==========================================

@never_cache
def api_bank_transactions(request):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    if request.method == 'GET':
        txns = [t.to_dict() for t in BankTransaction.objects.all()]
        return JsonResponse({'success': True, 'bank_transactions': txns})

    elif request.method == 'POST':
        try:
            data = json.loads(request.body.decode('utf-8')) if request.content_type == 'application/json' else request.POST

            desc = str(data.get('description') or '').strip()
            t_date_str = str(data.get('transaction_date') or '').strip()
            ref_id = str(data.get('reference_id') or '').strip() or None
            debit = Decimal(str(data.get('debit_amount', 0) or 0))
            credit = Decimal(str(data.get('credit_amount', 0) or 0))
            balance = Decimal(str(data.get('running_balance', 0) or 0))

            if not desc:
                return JsonResponse({'success': False, 'error': 'Description is required.'}, status=400)
            if not t_date_str:
                return JsonResponse({'success': False, 'error': 'Transaction date is required.'}, status=400)

            t_date = datetime.strptime(t_date_str, '%Y-%m-%d').date()

            txn = BankTransaction.objects.create(
                transaction_date=t_date,
                description=desc,
                reference_id=ref_id,
                debit_amount=debit,
                credit_amount=credit,
                running_balance=balance
            )

            baseline = calculate_forecast(cash_balance=float(balance), safe_threshold=150000.0)

            return JsonResponse({
                'success': True,
                'message': 'Bank transaction recorded successfully.',
                'bank_transaction': txn.to_dict(),
                'baseline': baseline
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)


@never_cache
def api_bank_transaction_detail(request, transaction_id):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    txn = get_object_or_404(BankTransaction, id=transaction_id)

    if request.method == 'GET':
        return JsonResponse({'success': True, 'bank_transaction': txn.to_dict()})

    elif request.method in ['POST', 'PUT']:
        try:
            data = json.loads(request.body.decode('utf-8')) if request.content_type == 'application/json' else request.POST
            if 'description' in data and data['description']:
                txn.description = str(data['description']).strip()
            if 'transaction_date' in data and data['transaction_date']:
                txn.transaction_date = datetime.strptime(str(data['transaction_date']).strip(), '%Y-%m-%d').date()
            if 'debit_amount' in data:
                txn.debit_amount = Decimal(str(data['debit_amount']))
            if 'credit_amount' in data:
                txn.credit_amount = Decimal(str(data['credit_amount']))
            if 'running_balance' in data:
                txn.running_balance = Decimal(str(data['running_balance']))

            txn.save()
            baseline = calculate_forecast(safe_threshold=150000.0)
            return JsonResponse({'success': True, 'bank_transaction': txn.to_dict(), 'baseline': baseline})
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    elif request.method == 'DELETE':
        txn.delete()
        baseline = calculate_forecast(safe_threshold=150000.0)
        return JsonResponse({'success': True, 'message': 'Bank transaction deleted.', 'baseline': baseline})

    return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)


# ==========================================
# 5. SERVER-SIDE UPLOAD & VALIDATION PIPELINE
# ==========================================

@never_cache
def api_upload_records(request):
    """
    Authoritative server-side multi-sheet CSV/Excel parsing and validation pipeline.
    Parses and categorizes records into Invoices, Expenses, Payment History, and Bank Txns,
    saving valid records directly to the database.
    """
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)

    try:
        content_text = ""
        if request.FILES.get('file'):
            uploaded_file = request.FILES['file']
            content_text = uploaded_file.read().decode('utf-8', errors='ignore')
        elif request.content_type == 'application/json':
            data = json.loads(request.body.decode('utf-8'))
            content_text = data.get('csv_content', '')
        else:
            content_text = request.POST.get('csv_content', '')

        if not content_text.strip():
            baseline = calculate_forecast(safe_threshold=150000.0)
            return JsonResponse({
                'success': True,
                'summary': {
                    'total_records': 0,
                    'valid_records': 0,
                    'requires_review_count': 0,
                    'duplicate_count': 0,
                    'invalid_count': 0
                },
                'issues': [],
                'baseline': baseline
            })

        # Parse CSV lines
        lines = content_text.splitlines()
        current_section = 'INVOICES'
        parsed_invoices = []
        parsed_expenses = []
        parsed_payments = []
        parsed_txns = []
        issues = []
        duplicates = 0
        invalid = 0

        for line in lines:
            line_str = line.strip()
            if not line_str or line_str.startswith('#'):
                continue

            if '[INVOICES]' in line_str.upper():
                current_section = 'INVOICES'
                continue
            elif '[EXPENSES]' in line_str.upper():
                current_section = 'EXPENSES'
                continue
            elif '[PAYMENT_HISTORY]' in line_str.upper():
                current_section = 'PAYMENT_HISTORY'
                continue
            elif '[BANK_TRANSACTIONS]' in line_str.upper():
                current_section = 'BANK_TRANSACTIONS'
                continue

            parts = [p.strip() for p in line_str.split(',')]
            # Skip header rows
            if 'Invoice ID' in parts[0] or 'Expense ID' in parts[0] or 'Customer Name' in parts[0] or 'Transaction Date' in parts[0]:
                continue

            if current_section == 'INVOICES' and len(parts) >= 3:
                inv_id = parts[0]
                cust = parts[1] if len(parts) > 1 else 'Unknown'
                try:
                    amt = float(parts[2])
                    if amt <= 0:
                        invalid += 1
                        issues.append({'id': inv_id, 'customer': cust, 'amount': amt, 'issue': 'Amount must be a positive number', 'category': 'Invoices'})
                        continue
                except Exception:
                    invalid += 1
                    issues.append({'id': inv_id, 'customer': cust, 'amount': 0, 'issue': 'Invalid numerical amount', 'category': 'Invoices'})
                    continue

                due_date_str = parts[3] if len(parts) > 3 and parts[3] else datetime.date.today().strftime('%Y-%m-%d')
                exp_date_str = parts[4] if len(parts) > 4 and parts[4] else None

                if not exp_date_str:
                    issues.append({'id': inv_id, 'customer': cust, 'amount': amt, 'issue': 'Missing expected payment date', 'category': 'Invoices'})

                try:
                    due_date = datetime.strptime(due_date_str, '%Y-%m-%d').date()
                except Exception:
                    due_date = datetime.date.today()

                exp_date = datetime.strptime(exp_date_str, '%Y-%m-%d').date() if exp_date_str else None

                # Persist or update in database
                inv, created = Invoice.objects.update_or_create(
                    invoice_id=inv_id,
                    defaults={
                        'customer': cust,
                        'amount': Decimal(str(amt)),
                        'due_date': due_date,
                        'expected_date': exp_date,
                        'status': 'Verified' if exp_date else 'Needs Review',
                        'concentration_risk': 'MEDIUM'
                    }
                )
                if not created:
                    duplicates += 1

                parsed_invoices.append(inv.to_dict())

            elif current_section == 'EXPENSES' and len(parts) >= 3:
                exp_id = parts[0]
                payee = parts[1]
                cat = parts[2] if len(parts) > 2 else 'Raw Materials'
                try:
                    amt = float(parts[3]) if len(parts) > 3 else 0.0
                except Exception:
                    amt = 0.0
                due_date_str = parts[4] if len(parts) > 4 and parts[4] else datetime.date.today().strftime('%Y-%m-%d')
                try:
                    due_date = datetime.strptime(due_date_str, '%Y-%m-%d').date()
                except Exception:
                    due_date = datetime.date.today()

                exp, _ = Expense.objects.update_or_create(
                    expense_id=exp_id,
                    defaults={
                        'payee': payee,
                        'category': cat,
                        'amount': Decimal(str(amt)),
                        'due_date': due_date,
                        'status': 'Upcoming'
                    }
                )
                parsed_expenses.append(exp.to_dict())

            elif current_section == 'PAYMENT_HISTORY' and len(parts) >= 2:
                cust = parts[0]
                try:
                    delay = int(parts[1])
                except Exception:
                    delay = 0
                ph, _ = PaymentHistory.objects.update_or_create(
                    customer=cust,
                    defaults={
                        'avg_delay_days': delay,
                        'payment_behavior': 'Stable Terms Adherence' if delay < 10 else 'Delay Tendency',
                        'risk_rating': 'LOW' if delay < 8 else 'MEDIUM'
                    }
                )
                parsed_payments.append(ph.to_dict())

            elif current_section == 'BANK_TRANSACTIONS' and len(parts) >= 2:
                t_date_str = parts[0]
                desc = parts[1]
                credit = Decimal(str(parts[2])) if len(parts) > 2 and parts[2] else Decimal('0')
                debit = Decimal(str(parts[3])) if len(parts) > 3 and parts[3] else Decimal('0')
                balance = Decimal(str(parts[4])) if len(parts) > 4 and parts[4] else Decimal('0')
                try:
                    t_date = datetime.strptime(t_date_str, '%Y-%m-%d').date()
                except Exception:
                    t_date = datetime.date.today()

                txn = BankTransaction.objects.create(
                    transaction_date=t_date,
                    description=desc,
                    credit_amount=credit,
                    debit_amount=debit,
                    running_balance=balance
                )
                parsed_txns.append(txn.to_dict())

        total = len(parsed_invoices) + len(parsed_expenses) + len(parsed_payments) + len(parsed_txns)
        req_review = len(issues)
        valid_count = max(0, total - req_review - invalid)

        baseline = calculate_forecast(safe_threshold=150000.0)

        return JsonResponse({
            'success': True,
            'summary': {
                'total_records': total,
                'valid_records': valid_count,
                'requires_review_count': req_review,
                'duplicate_count': duplicates,
                'invalid_count': invalid
            },
            'issues': issues,
            'baseline': baseline
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


# ==========================================
# 6. RESET DEMO, RECALCULATE & DOWNLOAD
# ==========================================

@never_cache
def api_reset_demo(request):
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    # Wipe all financial records to return to a clean empty state
    Invoice.objects.all().delete()
    Expense.objects.all().delete()
    PaymentHistory.objects.all().delete()
    BankTransaction.objects.all().delete()

    baseline = calculate_forecast(safe_threshold=150000.0)

    return JsonResponse({
        'success': True,
        'message': 'All financial data reset to clean empty state.',
        'invoices': [],
        'expenses': [],
        'payment_history': [],
        'bank_transactions': [],
        'baseline': baseline
    })


@never_cache
def api_recalculate_forecast(request):
    """
    Recalculates the central cash-flow ledger forecast dynamically from current saved database state.
    """
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    try:
        scenario_modifiers = None
        if request.method == 'POST' and request.body:
            try:
                data = json.loads(request.body.decode('utf-8'))
                scenario_modifiers = data.get('scenarioModifiers') or data.get('modifiers')
            except Exception:
                pass

        baseline = calculate_forecast(
            safe_threshold=150000.0,
            scenario_modifiers=scenario_modifiers
        )

        now_str = datetime.now().strftime('%d %b %Y, %H:%M:%S')

        return JsonResponse({
            'success': True,
            'message': 'Forecast recalculated successfully.',
            'calculated_at': now_str,
            'baseline': baseline
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@never_cache
def api_save_correction(request, invoice_id):
    """
    User Data Correction action:
    Updates an invoice's expected payment date, changes status to 'Verified',
    saves to database, and triggers forecast recalculation returning the new baseline.
    """
    if not request.session.get('is_authenticated', False):
        return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)

    if request.method not in ['POST', 'PUT']:
        return JsonResponse({'success': False, 'error': 'Method not allowed'}, status=405)

    try:
        inv = get_object_or_404(Invoice, invoice_id=invoice_id)

        if request.content_type == 'application/json':
            data = json.loads(request.body.decode('utf-8'))
        else:
            data = request.POST

        expected_date_str = str(data.get('expected_date') or '').strip()
        if not expected_date_str:
            return JsonResponse({'success': False, 'error': 'Expected payment date is required.'}, status=400)

        expected_date = datetime.strptime(expected_date_str, '%Y-%m-%d').date()

        inv.expected_date = expected_date
        inv.status = 'Verified'
        inv.save()

        baseline = calculate_forecast(safe_threshold=150000.0)
        now_str = datetime.now().strftime('%d %b %Y, %H:%M:%S')

        return JsonResponse({
            'success': True,
            'message': f'Correction saved for {inv.invoice_id}. Expected payment date set to {expected_date_str} and status marked as Verified.',
            'calculated_at': now_str,
            'invoice': inv.to_dict(),
            'baseline': baseline
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


def api_download_template(request):
    """
    Returns a downloadable CSV template with all 4 required financial categories.
    """
    content = """# CASHTWIN FINANCIAL RECORDS TEMPLATE
# Instructions: Fill out your business records under each category header below before uploading.

[INVOICES]
Invoice ID,Customer Name,Amount (INR),Due Date,Expected Payment Date,Payment Status,Concentration Risk
INV-001,Acme Enterprises,150000.00,2026-09-15,2026-09-22,Verified,MEDIUM
INV-002,Global Logistics,85000.00,2026-09-18,,Needs Review,LOW

[EXPENSES]
Expense ID,Payee / Vendor,Expense Category,Amount (INR),Due Date,Recurring Status
EXP-101,Industrial Power Co,Utilities,45000.00,2026-09-10,Upcoming
EXP-102,Staff Payroll,Payroll,120000.00,2026-09-12,Upcoming

[PAYMENT_HISTORY]
Customer Name,Average Payment Delay (Days),Payment Behaviour Profile,Historical Risk Indicator
Acme Enterprises,7,Stable Terms Adherence,LOW
Global Logistics,14,Moderate Delay Profile,MEDIUM

[BANK_TRANSACTIONS]
Transaction Date,Description,Credit (INR),Debit (INR),Running Balance (INR)
2026-09-01,Opening Account Balance,0.00,0.00,250000.00
"""
    response = HttpResponse(content, content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="CashTwin_Financial_Records_Template.csv"'
    return response


