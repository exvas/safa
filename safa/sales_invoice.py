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
        
    except Exception as e:
        frappe.log_error(f"Error in update_custom_fields_background: {str(e)}")

def after_insert_sales_invoice(doc, method=None):
    """Called after Sales Invoice is inserted"""
    try:
        # Run in background to avoid blocking
        frappe.enqueue(
            update_custom_fields_background,
            queue='short',
            timeout=60,
            doc_name=doc.name
        )
    except Exception as e:
        frappe.log_error(f"Error in after_insert_sales_invoice: {str(e)}")

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