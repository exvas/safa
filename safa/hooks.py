# safaqatar/hooks.py
# Updated to include custom invoice fields handlers

from . import __version__ as app_version

app_name = "safaqatar"
app_title = "Safaqatar"
app_publisher = "Your Company"
app_description = "Custom app for Safaqatar"
app_email = "your.email@example.com"
app_license = "MIT"


# Document Events
doc_events = {
    "Sales Invoice": {
        "after_insert": "safa.sales_invoice.after_insert_sales_invoice",
        "on_submit": "safa.sales_invoice.on_submit_sales_invoice",
    }
}

# App include js (if not already present)
app_include_js = [
    "/assets/safa/js/sales_invoice.js"
]

# App include css
app_include_css = [
    "/assets/safa/css/safa.css"
]