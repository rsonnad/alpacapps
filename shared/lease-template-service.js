/**
 * Lease Template Service
 * Handles lease template storage, parsing, and placeholder substitution
 */

import { supabase } from './supabase.js';

// All supported placeholders and their descriptions
const PLACEHOLDERS = {
  tenant_name: 'Full name of the tenant',
  tenant_email: 'Tenant email address',
  tenant_phone: 'Tenant phone number',
  signing_date: 'Current date formatted (e.g., "2nd day of February 2026")',
  lease_start_date: 'Move-in date (e.g., "February 15, 2026")',
  lease_end_date: 'Lease end date or "Open-ended"',
  dwelling_description: 'Name of the rental space',
  dwelling_location: 'Location/area of the space',
  rate: 'Rent amount (e.g., "$1,500")',
  rate_term: 'Payment frequency (month, week, night)',
  rate_display: 'Combined rate display (e.g., "$1,500/month")',
  security_deposit: 'Security deposit amount',
  move_in_deposit: 'Move-in deposit amount (first month rent)',
  reservation_deposit: 'Reservation deposit amount due after signing',
  application_fee_paid: 'Application fee amount paid (e.g., "$35")',
  application_fee_credit: 'Text describing application fee credit toward first month rent',
  reservation_deposit_credit: 'Text describing reservation deposit credit toward first month rent',
  total_credits: 'Total credits toward first month (app fee + reservation deposit)',
  first_month_due: 'Amount due for first month after all credits applied',
  notice_period: 'Notice period code (e.g., "30_days")',
  notice_period_display: 'Formatted notice period (e.g., "30 days notice required")',
  additional_terms: 'Custom additional terms',
};

/**
 * Get all available placeholders with descriptions
 */
function getAvailablePlaceholders() {
  return PLACEHOLDERS;
}

/**
 * Get the active lease template
 */
async function getActiveTemplate() {
  const { data, error } = await supabase
    .from('lease_templates')
    .select('*')
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('Error fetching active template:', error);
    throw error;
  }

  return data;
}

/**
 * Get all templates
 */
async function getAllTemplates() {
  const { data, error } = await supabase
    .from('lease_templates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching templates:', error);
    throw error;
  }

  return data || [];
}

/**
 * Save a new template or update existing
 */
async function saveTemplate(content, name, makeActive = false) {
  // Validate template first
  const validation = validateTemplate(content);
  if (!validation.isValid) {
    throw new Error(`Invalid template: ${validation.errors.join(', ')}`);
  }

  // If making active, deactivate all others first
  if (makeActive) {
    await supabase
      .from('lease_templates')
      .update({ is_active: false })
      .eq('is_active', true);
  }

  // Get current max version for this name
  const { data: existing } = await supabase
    .from('lease_templates')
    .select('version')
    .eq('name', name)
    .order('version', { ascending: false })
    .limit(1);

  const newVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  const { data, error } = await supabase
    .from('lease_templates')
    .insert({
      name,
      content,
      version: newVersion,
      is_active: makeActive,
    })
    .select()
    .single();

  if (error) {
    console.error('Error saving template:', error);
    throw error;
  }

  return data;
}

/**
 * Set a template as active
 */
async function setActiveTemplate(templateId) {
  // Deactivate all
  await supabase
    .from('lease_templates')
    .update({ is_active: false })
    .eq('is_active', true);

  // Activate selected
  const { data, error } = await supabase
    .from('lease_templates')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('id', templateId)
    .select()
    .single();

  if (error) {
    console.error('Error setting active template:', error);
    throw error;
  }

  return data;
}

/**
 * Validate a template for correct placeholders
 */
function validateTemplate(content) {
  const errors = [];
  const warnings = [];
  const foundPlaceholders = [];

  // Find all placeholders in the template
  const placeholderRegex = /\{\{(\w+)\}\}/g;
  let match;

  while ((match = placeholderRegex.exec(content)) !== null) {
    const placeholder = match[1];
    foundPlaceholders.push(placeholder);

    if (!PLACEHOLDERS[placeholder]) {
      errors.push(`Unknown placeholder: {{${placeholder}}}`);
    }
  }

  // Check for required placeholders (warnings only)
  const requiredPlaceholders = ['tenant_name', 'lease_start_date', 'rate_display'];
  for (const required of requiredPlaceholders) {
    if (!foundPlaceholders.includes(required)) {
      warnings.push(`Missing recommended placeholder: {{${required}}}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    foundPlaceholders: [...new Set(foundPlaceholders)],
  };
}

/**
 * Parse template and substitute placeholders with application data
 * @param {string} templateContent - Markdown template with {{placeholders}}
 * @param {Object} agreementData - Data from rentalService.getAgreementData()
 * @returns {string} - Parsed template with values substituted
 */
function parseTemplate(templateContent, agreementData) {
  // Map agreement data keys to placeholder names (handle camelCase to snake_case)
  const dataMap = {
    tenant_name: agreementData.tenantName,
    tenant_email: agreementData.tenantEmail,
    tenant_phone: agreementData.tenantPhone,
    signing_date: agreementData.signingDate,
    lease_start_date: agreementData.leaseStartDate,
    lease_end_date: agreementData.leaseEndDate,
    dwelling_description: agreementData.dwellingDescription,
    dwelling_location: agreementData.dwellingLocation,
    rate: agreementData.rate,
    rate_term: agreementData.rateTerm,
    rate_display: agreementData.rateDisplay,
    security_deposit: agreementData.securityDeposit,
    move_in_deposit: agreementData.moveInDeposit,
    reservation_deposit: agreementData.reservationDeposit,
    application_fee_paid: agreementData.applicationFeePaid,
    application_fee_credit: agreementData.applicationFeeCredit,
    reservation_deposit_credit: agreementData.reservationDepositCredit,
    total_credits: agreementData.totalCredits,
    first_month_due: agreementData.firstMonthDue,
    notice_period: agreementData.noticePeriod,
    notice_period_display: agreementData.noticePeriodDisplay,
    additional_terms: agreementData.additionalTerms || '',
  };

  // Replace all placeholders
  let parsed = templateContent;

  // Special handling for additional_terms - add conditional intro text
  const additionalTerms = agreementData.additionalTerms?.trim();
  if (additionalTerms) {
    // Replace {{additional_terms}} with intro text + the actual terms
    parsed = parsed.replace(
      /\{\{additional_terms\}\}/g,
      `The following additional terms will apply to this rental agreement:\n\n${additionalTerms}`
    );
  } else {
    // Remove the placeholder and any surrounding whitespace/newlines
    parsed = parsed.replace(/\{\{additional_terms\}\}/g, 'None.');
  }

  // Replace all other placeholders
  for (const [placeholder, value] of Object.entries(dataMap)) {
    if (placeholder === 'additional_terms') continue; // Already handled above
    const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
    parsed = parsed.replace(regex, value ?? '');
  }

  // Handle any remaining unmatched placeholders (replace with empty or keep)
  parsed = parsed.replace(/\{\{\w+\}\}/g, '');

  return parsed;
}

/**
 * Get a preview of the template with sample data
 */
function getTemplatePreview(templateContent) {
  const sampleData = {
    tenantName: 'John Smith',
    tenantEmail: 'john.smith@email.com',
    tenantPhone: '512-555-1234',
    signingDate: '2nd day of February 2026',
    leaseStartDate: 'February 15, 2026',
    leaseEndDate: 'February 15, 2027',
    dwellingDescription: 'The Cozy Cabin',
    dwellingLocation: 'Back Yard',
    rate: '$1,500',
    rateTerm: 'month',
    rateDisplay: '$1,500/month',
    securityDeposit: '$1,500',
    moveInDeposit: '$1,500',
    reservationDeposit: '$1,500',
    applicationFeePaid: '$35',
    applicationFeeCredit: 'Application fee of $35 has been received and will be credited toward the first month\'s rent.',
    reservationDepositCredit: 'Reservation deposit of $1,500 will be credited toward the first month\'s rent.',
    totalCredits: '$1,535',
    firstMonthDue: '$0',
    noticePeriod: '30_days',
    noticePeriodDisplay: '30 days notice required',
    additionalTerms: 'Tenant agrees to maintain the garden area.',
  };

  return parseTemplate(templateContent, sampleData);
}

// Default template for initial setup
const DEFAULT_TEMPLATE = `# RESIDENTIAL LEASE AGREEMENT

**GenAlpaca Residency**
160 Still Forest Drive, Cedar Creek, TX 78612

---

This Residential Lease Agreement ("Agreement") is entered into on **{{signing_date}}** between:

**LANDLORD:** GenAlpaca Residency ("Landlord")

**TENANT:** {{tenant_name}} ("Tenant")
- Email: {{tenant_email}}
- Phone: {{tenant_phone}}

---

## 1. PREMISES

The Landlord agrees to rent to the Tenant the dwelling unit described as:

- **Space:** {{dwelling_description}}
- **Location:** {{dwelling_location}}

Located at 160 Still Forest Drive, Cedar Creek, TX 78612 (the "Premises").

## 2. TERM

The lease term shall be:

- **Start Date:** {{lease_start_date}}
- **End Date:** {{lease_end_date}}

## 3. RENT

Tenant agrees to pay rent of **{{rate_display}}**.

- Rent is due on the 1st of each month
- Late payments are subject to a $50 late fee after the 5th day
- Accepted payment methods: Venmo, Zelle, PayPal, or Bank Transfer

## 4. DEPOSITS & PAYMENTS

- **Move-in Deposit:** {{move_in_deposit}} (equivalent to first month's rent)
- **Security Deposit:** {{security_deposit}}

{{application_fee_credit}}

**Amount Due at Move-in:** {{first_month_due}} (first month rent minus any application fee credit)

The security deposit will be returned within 30 days of move-out, less any deductions for damages beyond normal wear and tear.

## 5. EARLY TERMINATION

{{notice_period_display}}

Tenant must provide written notice of intent to vacate. Failure to provide proper notice may result in forfeiture of the security deposit.

## 6. HOUSE RULES

Tenant agrees to:
- Respect quiet hours (10 PM - 8 AM)
- Keep the premises clean and sanitary
- Not disturb other residents
- Report any maintenance issues promptly
- No illegal activities on the premises

## 7. UTILITIES

Unless otherwise specified, Tenant is responsible for their share of utilities including electricity, water, and internet.

## 8. ADDITIONAL TERMS

{{additional_terms}}

---

## SIGNATURES

By signing below, both parties agree to the terms of this Lease Agreement.

**LANDLORD**

Signature: _________________________

Name: GenAlpaca Residency

Date: _________________________


**TENANT**

Signature: _________________________

Name: {{tenant_name}}

Date: _________________________
`;

/**
 * Get the default template content
 */
function getDefaultTemplate() {
  return DEFAULT_TEMPLATE;
}

export const leaseTemplateService = {
  getAvailablePlaceholders,
  getActiveTemplate,
  getAllTemplates,
  saveTemplate,
  setActiveTemplate,
  validateTemplate,
  parseTemplate,
  getTemplatePreview,
  getDefaultTemplate,
};
