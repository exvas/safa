import frappe
from frappe import _
from frappe.utils import flt, now_datetime, fmt_money

@frappe.whitelist()
def get_customer_outstanding(customer, company):
    """Get customer's total outstanding amount"""
    try:
        # Get outstanding amount from Customer doctype
        outstanding_amount = frappe.db.sql("""
            SELECT 
                COALESCE(SUM(outstanding_amount), 0) as total_outstanding
            FROM `tabSales Invoice`
            WHERE customer = %s 
                AND company = %s 
                AND docstatus = 1 
                AND outstanding_amount > 0
        """, (customer, company), as_dict=True)
        
        total_outstanding = outstanding_amount[0].total_outstanding if outstanding_amount else 0
        
        return {
            "outstanding_amount": flt(total_outstanding, 2),
            "currency": frappe.get_cached_value("Company", company, "default_currency")
        }
    except Exception as e:
        frappe.log_error(f"Error in get_customer_outstanding: {str(e)}")
        return {"outstanding_amount": 0, "currency": "USD"}

@frappe.whitelist()
def get_customer_last_rate(customer, item_code, company):
    """Get customer's last selling rate for a specific item"""
    try:
        # Get the last selling rate for this customer and item
        last_rate_data = frappe.db.sql("""
            SELECT 
                sii.rate as last_rate,
                si.posting_date,
                si.name as invoice_name
            FROM `tabSales Invoice Item` sii
            JOIN `tabSales Invoice` si ON sii.parent = si.name
            WHERE si.customer = %s 
                AND sii.item_code = %s 
                AND si.company = %s
                AND si.docstatus = 1
            ORDER BY si.posting_date DESC, si.creation DESC
            LIMIT 1
        """, (customer, item_code, company), as_dict=True)
        
        if last_rate_data:
            return {
                "last_rate": flt(last_rate_data[0].last_rate, 2),
                "last_invoice_date": last_rate_data[0].posting_date,
                "last_invoice": last_rate_data[0].invoice_name
            }
        else:
            return {"last_rate": 0, "last_invoice_date": None, "last_invoice": None}
            
    except Exception as e:
        frappe.log_error(f"Error in get_customer_last_rate: {str(e)}")
        return {"last_rate": 0, "last_invoice_date": None, "last_invoice": None}

# Simple background update function that won't interfere with submit
def update_custom_fields_background(doc_name):
    """Background function to update custom fields after document is saved"""
    try:
        doc = frappe.get_doc("Sales Invoice", doc_name)
        
        if not doc.customer:
            return
            
        # Update customer outstanding in currency field
        outstanding_data = get_customer_outstanding(doc.customer, doc.company)
        if outstanding_data:
            outstanding_amount = outstanding_data.get("outstanding_amount", 0)
            
            frappe.db.set_value("Sales Invoice", doc_name, "custom_customer_outstanding", outstanding_amount, update_modified=False)
        
        # Update item last rates
        for item in doc.items:
            if item.item_code:
                last_rate_data = get_customer_last_rate(doc.customer, item.item_code, doc.company)
                if last_rate_data:
                    last_rate = last_rate_data.get("last_rate", 0)
                    frappe.db.set_value("Sales Invoice Item", item.name, "custom_customer_last_rate", last_rate, update_modified=False)
        
        frappe.db.commit()
        
        # Don't refresh the document to avoid triggering form updates
        frappe.clear_cache(doctype="Sales Invoice", name=doc_name)
        
    except Exception as e:
        frappe.log_error(f"Error in update_custom_fields_background: {str(e)}")

def on_submit_sales_invoice(doc, method=None):
    """Called when Sales Invoice is submitted"""
    try:
        # Run in background to avoid blocking
        frappe.enqueue(
            update_custom_fields_background,
            queue='short',
            timeout=60,
            doc_name=doc.name
        )
    except Exception as e:
        frappe.log_error(f"Error in on_submit_sales_invoice: {str(e)}")

# Utility function to get customer credit limit and used credit
def get_customer_credit_info(customer, company):
    """Get customer credit limit and usage information"""
    try:
        customer_doc = frappe.get_doc("Customer", customer)
        
        # Get credit limit
        credit_limit = 0
        for limit in customer_doc.credit_limits:
            if limit.company == company:
                credit_limit = limit.credit_limit
                break
        
        # Get used credit (outstanding amount)
        outstanding_data = get_customer_outstanding(customer, company)
        used_credit = outstanding_data.get("outstanding_amount", 0)
        
        # Calculate available credit
        available_credit = credit_limit - used_credit
        
        return {
            "credit_limit": credit_limit,
            "used_credit": used_credit,
            "available_credit": available_credit,
            "credit_utilization": (used_credit / credit_limit * 100) if credit_limit > 0 else 0
        }
        
    except Exception as e:
        frappe.log_error(f"Error in get_customer_credit_info: {str(e)}")
        return {
            "credit_limit": 0,
            "used_credit": 0,
            "available_credit": 0,
            "credit_utilization": 0
        }

# Method to get item price history for a customer
@frappe.whitelist()
def get_item_price_history(customer, item_code, company, limit=5):
    """Get price history of an item for a specific customer"""
    try:
        price_history = frappe.db.sql("""
            SELECT 
                sii.rate,
                sii.qty,
                sii.amount,
                si.posting_date,
                si.name as invoice_name
            FROM `tabSales Invoice Item` sii
            JOIN `tabSales Invoice` si ON sii.parent = si.name
            WHERE si.customer = %s 
                AND sii.item_code = %s 
                AND si.company = %s
                AND si.docstatus = 1
            ORDER BY si.posting_date DESC, si.creation DESC
            LIMIT %s
        """, (customer, item_code, company, limit), as_dict=True)
        
        return price_history
        
    except Exception as e:
        frappe.log_error(f"Error in get_item_price_history: {str(e)}")
        return []

@frappe.whitelist()
def create_quick_payment_entry(sales_invoice, mode_of_payment, paid_amount, posting_date, reference_no=None, reference_date=None, remarks=None):
    """Create a Payment Entry against Sales Invoice"""
    try:
        # Get Sales Invoice document
        si_doc = frappe.get_doc("Sales Invoice", sales_invoice)
        
        if si_doc.docstatus != 1:
            frappe.throw(_("Sales Invoice must be submitted to create payment entry"))
        
        if si_doc.outstanding_amount <= 0:
            frappe.throw(_("Sales Invoice has no outstanding amount"))
        
        paid_amount = float(paid_amount)
        if paid_amount > si_doc.outstanding_amount:
            frappe.throw(_("Paid amount cannot exceed outstanding amount"))
        
        # Get Mode of Payment details
        mop_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
        if not mop_doc.accounts:
            frappe.throw(_("Mode of Payment {0} has no associated accounts").format(mode_of_payment))
        
        # Find account for the company
        payment_account = None
        for account in mop_doc.accounts:
            if account.company == si_doc.company:
                payment_account = account.default_account
                break
        
        if not payment_account:
            frappe.throw(_("No account found for Mode of Payment {0} in company {1}").format(mode_of_payment, si_doc.company))
        
        # Create Payment Entry
        payment_entry = frappe.new_doc("Payment Entry")
        payment_entry.payment_type = "Receive"
        payment_entry.party_type = "Customer"
        payment_entry.party = si_doc.customer
        payment_entry.company = si_doc.company
        payment_entry.posting_date = posting_date
        payment_entry.paid_amount = paid_amount
        payment_entry.received_amount = paid_amount
        payment_entry.mode_of_payment = mode_of_payment
        payment_entry.paid_from = si_doc.debit_to
        payment_entry.paid_to = payment_account
        payment_entry.reference_no = reference_no
        payment_entry.reference_date = reference_date
        payment_entry.remarks = remarks or f"Payment against {sales_invoice}"
        
        # Add reference to Sales Invoice
        payment_entry.append("references", {
            "reference_doctype": "Sales Invoice",
            "reference_name": sales_invoice,
            "total_amount": si_doc.grand_total,
            "outstanding_amount": si_doc.outstanding_amount,
            "allocated_amount": paid_amount
        })
        
        # Set currency and exchange rate
        payment_entry.paid_from_account_currency = si_doc.currency
        payment_entry.paid_to_account_currency = frappe.get_cached_value("Account", payment_account, "account_currency")
        
        # Insert and submit
        payment_entry.insert()
        payment_entry.submit()
        
        return payment_entry.name
        
    except Exception as e:
        frappe.log_error(f"Error in create_quick_payment_entry: {str(e)}")
        frappe.throw(_("Error creating payment entry: {0}").format(str(e)))

@frappe.whitelist()
def create_quick_collection_entry(customer, company, collection_amount, mode_of_payment, posting_date, reference_no=None, reference_date=None, remarks=None):
    """Create a Payment Entry for quick collection without invoice reference"""
    try:
        collection_amount = float(collection_amount)
        if collection_amount <= 0:
            frappe.throw(_("Collection amount must be greater than zero"))
        
        # Get Mode of Payment details
        mop_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
        if not mop_doc.accounts:
            frappe.throw(_("Mode of Payment {0} has no associated accounts").format(mode_of_payment))
        
        # Find account for the company
        payment_account = None
        for account in mop_doc.accounts:
            if account.company == company:
                payment_account = account.default_account
                break
        
        if not payment_account:
            frappe.throw(_("No account found for Mode of Payment {0} in company {1}").format(mode_of_payment, company))
        
        # Get customer's receivable account
        customer_account = frappe.get_cached_value("Company", company, "default_receivable_account")
        if not customer_account:
            # Try to get from customer
            customer_doc = frappe.get_doc("Customer", customer)
            for account in customer_doc.accounts:
                if account.company == company:
                    customer_account = account.account
                    break
        
        if not customer_account:
            frappe.throw(_("No receivable account found for customer {0} in company {1}").format(customer, company))
        
        # Create Payment Entry
        payment_entry = frappe.new_doc("Payment Entry")
        payment_entry.payment_type = "Receive"
        payment_entry.party_type = "Customer"
        payment_entry.party = customer
        payment_entry.company = company
        payment_entry.posting_date = posting_date
        payment_entry.paid_amount = collection_amount
        payment_entry.received_amount = collection_amount
        payment_entry.mode_of_payment = mode_of_payment
        payment_entry.paid_from = customer_account
        payment_entry.paid_to = payment_account
        payment_entry.reference_no = reference_no
        payment_entry.reference_date = reference_date
        payment_entry.remarks = remarks or f"Quick Collection from {customer}"
        
        # Set currency and exchange rate
        payment_entry.paid_from_account_currency = frappe.get_cached_value("Company", company, "default_currency")
        payment_entry.paid_to_account_currency = frappe.get_cached_value("Account", payment_account, "account_currency")
        
        # Insert and submit
        payment_entry.insert()
        payment_entry.submit()
        
        return payment_entry.name
        
    except Exception as e:
        frappe.log_error(f"Error in create_quick_collection_entry: {str(e)}")
        frappe.throw(_("Error creating collection entry: {0}").format(str(e)))