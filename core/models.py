from django.db import models
from datetime import date


class Invoice(models.Model):
    CONCENTRATION_CHOICES = [
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
    ]
    STATUS_CHOICES = [
        ('Pending', 'Pending'),
        ('Paid', 'Paid'),
        ('Overdue', 'Overdue'),
        ('Verified', 'Verified'),
        ('Needs Review', 'Needs Review'),
    ]

    invoice_id = models.CharField(max_length=50, unique=True, primary_key=True)
    customer = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField()
    expected_date = models.DateField(null=True, blank=True)
    delay_days = models.IntegerField(null=True, blank=True)
    concentration_risk = models.CharField(max_length=20, choices=CONCENTRATION_CHOICES, default='MEDIUM')
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='Pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['due_date', 'invoice_id']

    def __str__(self):
        return f"{self.invoice_id} - {self.customer} (₹{self.amount})"

    def save(self, *args, **kwargs):
        if self.due_date and self.expected_date:
            diff = (self.expected_date - self.due_date).days
            self.delay_days = diff
        else:
            self.delay_days = None
        super().save(*args, **kwargs)

    def to_dict(self):
        return {
            'id': self.invoice_id,
            'customer': self.customer,
            'amount': float(self.amount),
            'due_date': self.due_date.strftime('%Y-%m-%d') if self.due_date else '',
            'expected_date': self.expected_date.strftime('%Y-%m-%d') if self.expected_date else None,
            'delay_days': self.delay_days,
            'concentration_risk': self.concentration_risk,
            'status': self.status,
        }


class Expense(models.Model):
    STATUS_CHOICES = [
        ('Upcoming', 'Upcoming'),
        ('Pending', 'Pending'),
        ('Paid', 'Paid'),
    ]

    expense_id = models.CharField(max_length=50, unique=True, primary_key=True)
    payee = models.CharField(max_length=255)
    category = models.CharField(max_length=100, default='Raw Materials')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField()
    recurring = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Upcoming')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['due_date', 'expense_id']

    def __str__(self):
        return f"{self.expense_id} - {self.payee} (₹{self.amount})"

    def to_dict(self):
        return {
            'id': self.expense_id,
            'payee': self.payee,
            'category': self.category,
            'amount': float(self.amount),
            'due_date': self.due_date.strftime('%Y-%m-%d') if self.due_date else '',
            'recurring': self.recurring,
            'status': self.status,
        }


class PaymentHistory(models.Model):
    RISK_CHOICES = [
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
    ]

    customer = models.CharField(max_length=255, unique=True, primary_key=True)
    avg_delay_days = models.IntegerField(default=0)
    payment_behavior = models.CharField(max_length=100, default='Stable Terms Adherence')
    risk_rating = models.CharField(max_length=20, choices=RISK_CHOICES, default='LOW')
    default_rate_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0.0)
    payment_reliability_score = models.IntegerField(default=90)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['customer']

    def __str__(self):
        return f"{self.customer} (+{self.avg_delay_days}d delay, {self.risk_rating})"

    def to_dict(self):
        return {
            'customer': self.customer,
            'avg_delay_days': self.avg_delay_days,
            'payment_behavior': self.payment_behavior,
            'risk_rating': self.risk_rating,
            'default_rate_pct': float(self.default_rate_pct),
            'payment_reliability_score': self.payment_reliability_score,
        }


class BankTransaction(models.Model):
    transaction_date = models.DateField()
    description = models.CharField(max_length=255)
    reference_id = models.CharField(max_length=100, null=True, blank=True)
    debit_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0.0)
    credit_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0.0)
    running_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-transaction_date', '-id']

    def __str__(self):
        return f"{self.transaction_date} - {self.description} (Bal: ₹{self.running_balance})"

    def to_dict(self):
        return {
            'id': self.id,
            'transaction_date': self.transaction_date.strftime('%Y-%m-%d') if self.transaction_date else '',
            'description': self.description,
            'reference_id': self.reference_id or f"TXN-{self.id}",
            'debit_amount': float(self.debit_amount),
            'credit_amount': float(self.credit_amount),
            'running_balance': float(self.running_balance),
        }
