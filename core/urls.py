from django.urls import path
from . import views

app_name = 'core'

urlpatterns = [
    path('', views.landing, name='landing'),
    path('auth/', views.auth_flow, name='auth_flow'),
    path('logout/', views.logout_view, name='logout'),
    path('app/', views.app_dashboard, name='app_dashboard'),
    
    # Invoices DB API
    path('api/invoices/', views.api_invoices, name='api_invoices'),
    path('api/invoices/<str:invoice_id>/', views.api_invoice_detail, name='api_invoice_detail'),
    path('api/invoices/<str:invoice_id>/correction/', views.api_save_correction, name='api_save_correction'),
    
    # Expenses DB API
    path('api/expenses/', views.api_expenses, name='api_expenses'),
    path('api/expenses/<str:expense_id>/', views.api_expense_detail, name='api_expense_detail'),

    # Payment History DB API
    path('api/payment-history/', views.api_payment_history, name='api_payment_history'),
    path('api/payment-history/<str:customer>/', views.api_payment_history_detail, name='api_payment_history_detail'),

    # Bank Transactions DB API
    path('api/bank-transactions/', views.api_bank_transactions, name='api_bank_transactions'),
    path('api/bank-transactions/<int:transaction_id>/', views.api_bank_transaction_detail, name='api_bank_transaction_detail'),

    # Upload & Multi-sheet Validation Pipeline
    path('api/upload-records/', views.api_upload_records, name='api_upload_records'),
    
    # Forecast Engine API
    path('api/recalculate-forecast/', views.api_recalculate_forecast, name='api_recalculate_forecast'),
    path('api/forecast/', views.api_recalculate_forecast, name='api_forecast'),
    
    # Download Template API
    path('api/download-template/', views.api_download_template, name='api_download_template'),

    # Reset API
    path('api/reset-demo/', views.api_reset_demo, name='api_reset_demo'),
]
