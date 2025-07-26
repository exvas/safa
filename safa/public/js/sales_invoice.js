frappe.ui.form.on('Sales Invoice', {
	refresh: function(frm) {
		frm.toggle_display("loyalty_points_redemption", false);
		frm.toggle_display("total_qty", false);
	    frm.toggle_display("tax_category", false);
	    frm.toggle_display("tax_category", false);
	    frm.toggle_display("shipping_rule", false);
	    frm.toggle_display("incoterm", false);
	    frm.toggle_display("named_place", false);
	    frm.toggle_display("scan_barcode", false);
	    frm.toggle_display("time_sheet_list", false);
	    frm.toggle_display("subscription_section", false);
	    frm.toggle_display("taxes_and_charges", false);
	    frm.toggle_display("taxes", false);
	    
	}
});

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
    
    // Trigger on form refresh
    refresh: function(frm) {
        console.log("Form refreshed");
        // Make custom_payment_type field mandatory
        frm.toggle_reqd('custom_payment_type', true);
        set_pos_based_on_payment_type(frm);
        manage_sales_team(frm);
        
        // Style the Customer Outstanding label to be red and bold
        setTimeout(() => {
            $('[data-fieldname="custom_customer_outstanding"] .control-label').css({
                'color': '#dc3545',
                'font-weight': 'bold'
            });
        }, 500);
        
        // Fetch customer data if customer is selected
        if (frm.doc.customer) {
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