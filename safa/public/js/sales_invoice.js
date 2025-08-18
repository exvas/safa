frappe.ui.form.on('Sales Invoice', {
    // Trigger when custom_payment_type field changes
    custom_payment_type: function(frm) {
        console.log("Custom payment type changed to:", frm.doc.custom_payment_type);
        set_pos_based_on_payment_type(frm);
    },
    
    // Trigger when custom_salesman field changes
    custom_salesman: function(frm) {
        console.log("Custom salesman changed to:", frm.doc.custom_salesman);
        manage_sales_team(frm);
    },
    
    // Trigger when customer changes
    customer: function(frm) {
        if (frm.doc.customer) {
            fetch_customer_outstanding(frm);
            fetch_items_last_rates(frm);
        }
    },
    
    // Trigger on form refresh - CONSOLIDATED REFRESH FUNCTION
    refresh: function(frm) {
        console.log("Form refreshed");
        
        // Always hide these fields
        frm.toggle_display("loyalty_points_redemption", false);
        frm.toggle_display("total_qty", false);
        frm.toggle_display("tax_category", false);
        frm.toggle_display("shipping_rule", false);
        frm.toggle_display("incoterm", false);
        frm.toggle_display("named_place", false);
        frm.toggle_display("scan_barcode", false);
        frm.toggle_display("time_sheet_list", false);
        frm.toggle_display("subscription_section", false);
        frm.toggle_display("taxes_and_charges", false);
        frm.toggle_display("taxes", false);
        
        // Only run these functions if the document is not submitted (not read-only)
        if (frm.doc.docstatus === 0) {
            // Make custom_payment_type field mandatory
            frm.toggle_reqd('custom_payment_type', true);
            set_pos_based_on_payment_type(frm);
            manage_sales_team(frm);
        }
        
        // Debug logging for payment button (reduced)
        console.log("Form refreshed - Doc Status:", frm.doc.docstatus, "Outstanding:", frm.doc.outstanding_amount, "Status:", frm.doc.status);
        
        // Add Quick Payment button - show for any submitted invoice for testing
        let show_payment_button = false;
        
        if (frm.doc.docstatus === 1) {
            // Show for any submitted invoice (for testing - can be made stricter later)
            show_payment_button = true;
        }
        
        console.log("Show Payment Button:", show_payment_button);
        
        if (show_payment_button) {
            try {
                // Add to Create dropdown
                frm.add_custom_button(__('Quick Payment'), function() {
                    console.log("Quick Payment clicked");
                    show_quick_payment_dialog(frm);
                }, __('Create'));
                
                // Add prominent button in main toolbar
                frm.add_custom_button(__('💳 Quick Payment'), function() {
                    console.log("Quick Payment toolbar clicked");
                    show_quick_payment_dialog(frm);
                }).addClass('btn-success');
                
                console.log("Quick Payment buttons added successfully");
            } catch(error) {
                console.error("Error adding Quick Payment buttons:", error);
            }
        }
        
        // Always show Quick Collection button (independent of invoice)
        try {
            frm.add_custom_button(__('Quick Collection'), function() {
                console.log("Quick Collection dropdown clicked");
                show_quick_collection_dialog(frm);
            }, __('Create'));
            
            // Add prominent Quick Collection button in main toolbar
            frm.add_custom_button(__('💰 Quick Collection'), function() {
                console.log("Quick Collection toolbar clicked");
                show_quick_collection_dialog(frm);
            }).addClass('btn-info');
            
            console.log("Quick Collection buttons added successfully");
        } catch(error) {
            console.error("Error adding Quick Collection buttons:", error);
        }
        
        // Style the Customer Outstanding label to be red and bold (always do this)
        setTimeout(() => {
            $('[data-fieldname="custom_customer_outstanding"] .control-label').css({
                'color': '#dc3545',
                'font-weight': 'bold'
            });
        }, 500);
        
        // Fetch customer data ONLY for draft invoices to avoid triggering updates
        if (frm.doc.customer && frm.doc.docstatus === 0) {
            fetch_customer_outstanding(frm);
            fetch_items_last_rates(frm);
        }
    }
    
    // REMOVED: before_save, validate - these were blocking submit
});

// Event for Sales Invoice Item table
frappe.ui.form.on('Sales Invoice Item', {
    item_code: function(frm, cdt, cdn) {
        // When item is selected, fetch last rate for this specific item
        let row = locals[cdt][cdn];
        if (row.item_code && frm.doc.customer) {
            fetch_item_last_rate(frm, row.item_code, cdn);
        }
    },
    
    items_add: function(frm, cdt, cdn) {
        // When new item is added, fetch last rate if item_code exists
        let row = locals[cdt][cdn];
        if (row.item_code && frm.doc.customer) {
            fetch_item_last_rate(frm, row.item_code, cdn);
        }
    }
});

// Helper function to set POS based on payment type
function set_pos_based_on_payment_type(frm) {
    // Don't modify if document is submitted
    if (frm.doc.docstatus !== 0) {
        return;
    }
    
    let payment_value = frm.doc.custom_payment_type;
    
    console.log("Current custom_payment_type value:", payment_value);
    console.log("Current is_pos value:", frm.doc.is_pos);
    
    if (payment_value === 'Cash') {
        console.log("Setting is_pos to 1 (Cash selected)");
        frm.set_value('is_pos', 1);
    } else if (payment_value === 'Credit') {
        console.log("Setting is_pos to 0 (Credit selected)");
        frm.set_value('is_pos', 0);
    } else {
        console.log("Payment type not Cash or Credit, current value:", payment_value);
    }
}

// Helper function to manage sales team based on custom salesman
function manage_sales_team(frm) {
    // Don't modify if document is submitted
    if (frm.doc.docstatus !== 0) {
        return;
    }
    
    if (!frm.doc.custom_salesman) {
        console.log("No custom salesman selected");
        return;
    }
    
    console.log("Managing sales team for salesman:", frm.doc.custom_salesman);
    
    // Check if sales_team table exists, if not initialize it
    if (!frm.doc.sales_team) {
        frm.doc.sales_team = [];
    }
    
    // Check if the salesman already exists in sales_team
    let existing_salesman = frm.doc.sales_team.find(row => row.sales_person === frm.doc.custom_salesman);
    
    if (existing_salesman) {
        console.log("Salesman already exists in sales team:", frm.doc.custom_salesman);
        return;
    }
    
    // Check if there's any other salesman in the sales_team
    if (frm.doc.sales_team.length > 0) {
        console.log("Updating existing sales person to:", frm.doc.custom_salesman);
        // Update the first row with new salesman
        frm.doc.sales_team[0].sales_person = frm.doc.custom_salesman;
        frm.doc.sales_team[0].allocated_percentage = 100;
        frm.doc.sales_team[0].allocated_amount = 0; // Will be calculated automatically
    } else {
        console.log("Adding new sales person to sales team:", frm.doc.custom_salesman);
        // Add new row to sales_team
        let new_row = frm.add_child('sales_team');
        new_row.sales_person = frm.doc.custom_salesman;
        new_row.allocated_percentage = 100;
        new_row.allocated_amount = 0; // Will be calculated automatically
    }
    
    // Refresh the sales_team field to show changes
    frm.refresh_field('sales_team');
    console.log("Sales team updated successfully");
}

// Function to fetch customer outstanding amount
function fetch_customer_outstanding(frm) {
    return new Promise((resolve) => {
        if (!frm.doc.customer) {
            resolve();
            return;
        }
        
        frappe.call({
            method: 'safa.sales_invoice.get_customer_outstanding',
            args: {
                customer: frm.doc.customer,
                company: frm.doc.company
            },
            callback: function(response) {
                if (response.message) {
                    // Set the outstanding amount in the currency field
                    let amount = response.message.outstanding_amount;
                    frm.set_value('custom_customer_outstanding', amount);
                    frm.refresh_field('custom_customer_outstanding');
                }
                resolve();
            },
            error: function(err) {
                console.error("Error fetching customer outstanding:", err);
                resolve();
            }
        });
    });
}

// Function to fetch last rates for all items
function fetch_items_last_rates(frm) {
    return new Promise((resolve) => {
        if (!frm.doc.customer || !frm.doc.items || frm.doc.items.length === 0) {
            resolve();
            return;
        }
        
        let promises = [];
        frm.doc.items.forEach((item, index) => {
            if (item.item_code) {
                promises.push(fetch_item_last_rate(frm, item.item_code, item.name));
            }
        });
        
        Promise.all(promises).then(() => {
            resolve();
        });
    });
}

// Function to fetch last rate for a specific item
function fetch_item_last_rate(frm, item_code, row_name) {
    return new Promise((resolve) => {
        frappe.call({
            method: 'safa.sales_invoice.get_customer_last_rate',
            args: {
                customer: frm.doc.customer,
                item_code: item_code,
                company: frm.doc.company
            },
            callback: function(response) {
                if (response.message) {
                    // Find the row and update the custom field
                    let row = frm.doc.items.find(item => item.name === row_name);
                    if (row) {
                        frappe.model.set_value('Sales Invoice Item', row_name, 'custom_customer_last_rate', response.message.last_rate);
                        frm.refresh_field('items');
                    }
                }
                resolve();
            },
            error: function(err) {
                console.error("Error fetching last rate for item:", item_code, err);
                resolve();
            }
        });
    });
}

// Function to show mobile-compatible quick payment dialog
function show_quick_payment_dialog(frm) {
    console.log("Opening Quick Payment Dialog - Outstanding:", frm.doc.outstanding_amount);
    
    // Calculate outstanding amount - use grand total if outstanding is not set
    let outstanding_amount = frm.doc.outstanding_amount || frm.doc.grand_total || 0;
    
    if (outstanding_amount <= 0) {
        frappe.msgprint(__('No outstanding amount to pay'));
        return;
    }
    
    try {
        let dialog = new frappe.ui.Dialog({
            title: __('Quick Payment Entry'),
            size: 'small', // Makes it mobile-friendly
            fields: [
                {
                    fieldtype: 'Currency',
                    fieldname: 'outstanding_amount',
                    label: __('Outstanding Amount'),
                    default: outstanding_amount,
                    read_only: 1,
                    bold: 1
                },
                {
                    fieldtype: 'Column Break'
                },
                {
                    fieldtype: 'Currency',
                    fieldname: 'paid_amount',
                    label: __('Paid Amount'),
                    reqd: 1,
                    default: outstanding_amount,
                    onchange: function() {
                        let paid_amount = dialog.get_value('paid_amount');
                        if (paid_amount > outstanding_amount) {
                            frappe.msgprint(__('Paid amount cannot exceed outstanding amount of {0}', [format_currency(outstanding_amount)]));
                            dialog.set_value('paid_amount', outstanding_amount);
                        }
                        if (paid_amount <= 0) {
                            frappe.msgprint(__('Paid amount must be greater than zero'));
                            dialog.set_value('paid_amount', outstanding_amount);
                        }
                    }
                },
            {
                fieldtype: 'Section Break'
            },
            {
                fieldtype: 'Link',
                fieldname: 'mode_of_payment',
                label: __('Mode of Payment'),
                options: 'Mode of Payment',
                reqd: 1,
                onchange: function() {
                    let mode_of_payment = dialog.get_value('mode_of_payment');
                    // Show/hide and make required reference fields based on payment mode
                    if (mode_of_payment && 
                        ['Cheque', 'Bank Draft', 'Wire Transfer', 'Bank Transfer', 'NEFT', 'RTGS'].includes(mode_of_payment)) {
                        dialog.fields_dict.reference_no.df.hidden = 0;
                        dialog.fields_dict.reference_no.df.reqd = 1;
                        dialog.fields_dict.reference_date.df.hidden = 0;
                        dialog.fields_dict.reference_date.df.reqd = 1;
                        dialog.refresh();
                    } else {
                        dialog.fields_dict.reference_no.df.hidden = 1;
                        dialog.fields_dict.reference_no.df.reqd = 0;
                        dialog.fields_dict.reference_date.df.hidden = 1;
                        dialog.fields_dict.reference_date.df.reqd = 0;
                        dialog.refresh();
                    }
                }
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldtype: 'Date',
                fieldname: 'posting_date',
                label: __('Posting Date'),
                default: frappe.datetime.get_today(),
                reqd: 1
            },
            {
                fieldtype: 'Section Break'
            },
            {
                fieldtype: 'Data',
                fieldname: 'reference_no',
                label: __('Cheque/Reference No'),
                hidden: 1
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldtype: 'Date',
                fieldname: 'reference_date',
                label: __('Cheque/Reference Date'),
                hidden: 1,
                default: frappe.datetime.get_today()
            },
            {
                fieldtype: 'Section Break'
            },
            {
                fieldtype: 'Small Text',
                fieldname: 'remarks',
                label: __('Remarks'),
                default: `Payment against ${frm.doc.name}`
            }
        ],
        primary_action_label: __('Create Payment'),
        primary_action: function() {
            let values = dialog.get_values();
            
            if (!values) {
                return;
            }
            
            // Validation
            if (values.paid_amount <= 0) {
                frappe.msgprint(__('Paid amount must be greater than zero'));
                return;
            }
            
            if (values.paid_amount > outstanding_amount) {
                frappe.msgprint(__('Paid amount cannot exceed outstanding amount of {0}', [format_currency(outstanding_amount)]));
                return;
            }
            
            // Check if reference fields are required and provided
            if (values.mode_of_payment && 
                ['Cheque', 'Bank Draft', 'Wire Transfer', 'Bank Transfer', 'NEFT', 'RTGS'].includes(values.mode_of_payment)) {
                if (!values.reference_no || values.reference_no.trim() === '') {
                    frappe.msgprint(__('Reference No is mandatory for {0}', [values.mode_of_payment]));
                    return;
                }
                if (!values.reference_date) {
                    frappe.msgprint(__('Reference Date is mandatory for {0}', [values.mode_of_payment]));
                    return;
                }
            }
            
            // Create payment entry
            frappe.call({
                method: 'safa.sales_invoice.create_quick_payment_entry',
                args: {
                    sales_invoice: frm.doc.name,
                    mode_of_payment: values.mode_of_payment,
                    paid_amount: values.paid_amount,
                    posting_date: values.posting_date,
                    reference_no: values.reference_no,
                    reference_date: values.reference_date,
                    remarks: values.remarks
                },
                freeze: true,
                freeze_message: __('Creating Payment Entry...'),
                callback: function(response) {
                    if (response.message) {
                        frappe.msgprint({
                            title: __('Success'),
                            message: __('Payment Entry {0} created successfully', [`<a href="#Form/Payment Entry/${response.message}">${response.message}</a>`]),
                            indicator: 'green'
                        });
                        dialog.hide();
                        frm.reload_doc(); // Refresh the form to show updated outstanding amount
                    }
                },
                error: function(error) {
                    frappe.msgprint({
                        title: __('Error'),
                        message: __('Failed to create payment entry. Please try again.'),
                        indicator: 'red'
                    });
                }
            });
        }
    });
    
    dialog.show();
    
    // Make dialog mobile-friendly and apply CSS class
    setTimeout(() => {
        $('.modal-dialog').addClass('quick-payment-dialog');
        $('.modal-body').css('max-height', '80vh').css('overflow-y', 'auto');
    }, 100);
    
    } catch(error) {
        console.error("Error creating Quick Payment dialog:", error);
        frappe.msgprint({
            title: __('Error'),
            message: __('Failed to open payment dialog. Please try again.'),
            indicator: 'red'
        });
    }
}

// Function to show mobile-compatible quick collection dialog
function show_quick_collection_dialog(frm) {
    console.log("Opening Quick Collection Dialog");
    
    try {
        let dialog = new frappe.ui.Dialog({
            title: __('💰 Quick Collection'),
            size: 'small',
            fields: [
                {
                    fieldtype: 'Link',
                    fieldname: 'customer',
                    label: __('Customer'),
                    options: 'Customer',
                    reqd: 1,
                    default: frm.doc.customer || '',
                    onchange: function() {
                        let customer = dialog.get_value('customer');
                        if (customer) {
                            console.log("Fetching outstanding for customer:", customer);
                            // Add a timeout to prevent hanging
                            setTimeout(() => {
                                frappe.call({
                                    method: 'safa.sales_invoice.get_customer_outstanding',
                                    args: {
                                        customer: customer,
                                        company: frm.doc.company || frappe.defaults.get_default('Company')
                                    },
                                    timeout: 10, // 10 second timeout
                                    callback: function(response) {
                                        console.log("Outstanding response:", response);
                                        if (response && response.message) {
                                            let outstanding = response.message.outstanding_amount || 0;
                                            console.log("Setting outstanding to:", outstanding);
                                            dialog.set_value('customer_outstanding', outstanding);
                                        } else {
                                            console.log("No outstanding data, setting to 0");
                                            dialog.set_value('customer_outstanding', 0);
                                        }
                                    },
                                    error: function(error) {
                                        console.error("Error fetching customer outstanding:", error);
                                        dialog.set_value('customer_outstanding', 0);
                                        frappe.msgprint(__('Could not fetch customer outstanding. Please try again.'));
                                    }
                                });
                            }, 100); // Small delay to prevent rapid calls
                        } else {
                            dialog.set_value('customer_outstanding', 0);
                        }
                    }
                },
                {
                    fieldtype: 'Column Break'
                },
                {
                    fieldtype: 'Currency',
                    fieldname: 'customer_outstanding',
                    label: __('Customer Outstanding'),
                    read_only: 1,
                    bold: 1,
                    default: 0
                },
                {
                    fieldtype: 'Section Break'
                },
                {
                    fieldtype: 'Currency',
                    fieldname: 'collection_amount',
                    label: __('Collection Amount'),
                    reqd: 1,
                    default: 0,
                    description: 'Enter the amount to collect from customer'
                },
                {
                    fieldtype: 'Column Break'
                },
                {
                    fieldtype: 'Link',
                    fieldname: 'mode_of_payment',
                    label: __('Mode of Payment'),
                    options: 'Mode of Payment',
                    reqd: 1,
                    onchange: function() {
                        let mode_of_payment = dialog.get_value('mode_of_payment');
                        // Show/hide and make required reference fields based on payment mode
                        if (mode_of_payment && 
                            ['Cheque', 'Bank Draft', 'Wire Transfer', 'Bank Transfer', 'NEFT', 'RTGS'].includes(mode_of_payment)) {
                            dialog.fields_dict.reference_no.df.hidden = 0;
                            dialog.fields_dict.reference_no.df.reqd = 1;
                            dialog.fields_dict.reference_date.df.hidden = 0;
                            dialog.fields_dict.reference_date.df.reqd = 1;
                            dialog.refresh();
                        } else {
                            dialog.fields_dict.reference_no.df.hidden = 1;
                            dialog.fields_dict.reference_no.df.reqd = 0;
                            dialog.fields_dict.reference_date.df.hidden = 1;
                            dialog.fields_dict.reference_date.df.reqd = 0;
                            dialog.refresh();
                        }
                    }
                },
                {
                    fieldtype: 'Section Break'
                },
                {
                    fieldtype: 'Date',
                    fieldname: 'posting_date',
                    label: __('Posting Date'),
                    default: frappe.datetime.get_today(),
                    reqd: 1
                },
                {
                    fieldtype: 'Column Break'
                },
                {
                    fieldtype: 'Link',
                    fieldname: 'company',
                    label: __('Company'),
                    options: 'Company',
                    default: frm.doc.company || frappe.defaults.get_default('Company'),
                    reqd: 1
                },
                {
                    fieldtype: 'Section Break'
                },
                {
                    fieldtype: 'Data',
                    fieldname: 'reference_no',
                    label: __('Cheque/Reference No'),
                    hidden: 1
                },
                {
                    fieldtype: 'Column Break'
                },
                {
                    fieldtype: 'Date',
                    fieldname: 'reference_date',
                    label: __('Cheque/Reference Date'),
                    hidden: 1,
                    default: frappe.datetime.get_today()
                },
                {
                    fieldtype: 'Section Break'
                },
                {
                    fieldtype: 'Small Text',
                    fieldname: 'remarks',
                    label: __('Remarks'),
                    default: 'Quick Collection Payment'
                }
            ],
            primary_action_label: __('Create Collection'),
            primary_action: function() {
                let values = dialog.get_values();
                
                if (!values) {
                    return;
                }
                
                // Validation
                if (!values.customer) {
                    frappe.msgprint(__('Please select a customer'));
                    return;
                }
                
                if (values.collection_amount <= 0) {
                    frappe.msgprint(__('Collection amount must be greater than zero'));
                    return;
                }
                
                if (!values.mode_of_payment) {
                    frappe.msgprint(__('Please select mode of payment'));
                    return;
                }
                
                // Check if reference fields are required and provided
                if (values.mode_of_payment && 
                    ['Cheque', 'Bank Draft', 'Wire Transfer', 'Bank Transfer', 'NEFT', 'RTGS'].includes(values.mode_of_payment)) {
                    if (!values.reference_no || values.reference_no.trim() === '') {
                        frappe.msgprint(__('Reference No is mandatory for {0}', [values.mode_of_payment]));
                        return;
                    }
                    if (!values.reference_date) {
                        frappe.msgprint(__('Reference Date is mandatory for {0}', [values.mode_of_payment]));
                        return;
                    }
                }
                
                // Create payment entry
                frappe.call({
                    method: 'safa.sales_invoice.create_quick_collection_entry',
                    args: {
                        customer: values.customer,
                        company: values.company,
                        collection_amount: values.collection_amount,
                        mode_of_payment: values.mode_of_payment,
                        posting_date: values.posting_date,
                        reference_no: values.reference_no,
                        reference_date: values.reference_date,
                        remarks: values.remarks
                    },
                    freeze: true,
                    freeze_message: __('Creating Collection Entry...'),
                    callback: function(response) {
                        if (response.message) {
                            frappe.msgprint({
                                title: __('Success'),
                                message: __('Payment Entry {0} created successfully', [`<a href="#Form/Payment Entry/${response.message}">${response.message}</a>`]),
                                indicator: 'green'
                            });
                            dialog.hide();
                            frm.reload_doc(); // Refresh the form
                        }
                    },
                    error: function(error) {
                        frappe.msgprint({
                            title: __('Error'),
                            message: __('Failed to create collection entry. Please try again.'),
                            indicator: 'red'
                        });
                    }
                });
            }
        });
        
        dialog.show();
        
        // Make dialog mobile-friendly and apply CSS class
        setTimeout(() => {
            $('.modal-dialog').addClass('quick-collection-dialog');
            $('.modal-body').css('max-height', '80vh').css('overflow-y', 'auto');
        }, 100);
        
    } catch(error) {
        console.error("Error creating Quick Collection dialog:", error);
        frappe.msgprint({
            title: __('Error'),
            message: __('Failed to open collection dialog. Please try again.'),
            indicator: 'red'
        });
    }
}