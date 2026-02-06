/**
 * Work Trade Template Service
 * Handles work trade agreement template storage, parsing, and placeholder substitution
 */

import { supabase } from './supabase.js';

// All supported placeholders and their descriptions
const PLACEHOLDERS = {
  // Renter info
  tenant_name: 'Full name of the work trade renter',
  tenant_email: 'Renter email address',
  tenant_phone: 'Renter phone number',
  emergency_contact: 'Emergency contact name and phone number',

  // Dwelling
  dwelling_description: 'Description of the rental unit (e.g., "the cabin on the west most part of the property")',

  // Financial
  rate: 'Monthly rent amount (e.g., "$599")',
  security_deposit: 'Security/cleaning deposit amount (e.g., "$300")',
  pay_rate: 'Hourly pay rate for work (e.g., "$25")',
  pay_rate_terms: 'Pay rate terms (e.g., "for first 90 days. Negotiated rate after 90 days.")',
  min_hours_per_week: 'Minimum hours of work per week (e.g., "6")',

  // Dates & Terms
  agreement_start_date: 'Start date of the agreement (e.g., "June 30, 2024")',
  notice_period: 'Notice period for termination (e.g., "2 weeks")',
  signing_date: 'Date the agreement is signed',

  // Work details
  house_manager: 'Name(s) of the house manager(s) assigning tasks',
  excluded_work_types: 'Types of work the renter requests not to be assigned',
  work_schedule: 'Work schedule details',

  // Additional
  additional_terms: 'Custom additional terms',
};

/**
 * Get all available placeholders with descriptions
 */
function getAvailablePlaceholders() {
  return PLACEHOLDERS;
}

/**
 * Get the active work trade agreement template
 */
async function getActiveTemplate() {
  const { data, error } = await supabase
    .from('worktrade_agreement_templates')
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
    .from('worktrade_agreement_templates')
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
      .from('worktrade_agreement_templates')
      .update({ is_active: false })
      .eq('is_active', true);
  }

  // Get current max version for this name
  const { data: existing } = await supabase
    .from('worktrade_agreement_templates')
    .select('version')
    .eq('name', name)
    .order('version', { ascending: false })
    .limit(1);

  const newVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  const { data, error } = await supabase
    .from('worktrade_agreement_templates')
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
    .from('worktrade_agreement_templates')
    .update({ is_active: false })
    .eq('is_active', true);

  // Activate selected
  const { data, error } = await supabase
    .from('worktrade_agreement_templates')
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
  const requiredPlaceholders = ['tenant_name', 'rate', 'agreement_start_date'];
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
 * Parse template and substitute placeholders with agreement data
 * @param {string} templateContent - Markdown template with {{placeholders}}
 * @param {Object} agreementData - Data for the work trade agreement
 * @returns {string} - Parsed template with values substituted
 */
function parseTemplate(templateContent, agreementData) {
  // Map agreement data keys to placeholder names (handle camelCase to snake_case)
  const dataMap = {
    tenant_name: agreementData.tenantName,
    tenant_email: agreementData.tenantEmail,
    tenant_phone: agreementData.tenantPhone,
    emergency_contact: agreementData.emergencyContact,
    dwelling_description: agreementData.dwellingDescription,
    rate: agreementData.rate,
    security_deposit: agreementData.securityDeposit,
    pay_rate: agreementData.payRate,
    pay_rate_terms: agreementData.payRateTerms,
    min_hours_per_week: agreementData.minHoursPerWeek,
    agreement_start_date: agreementData.agreementStartDate,
    notice_period: agreementData.noticePeriod,
    signing_date: agreementData.signingDate,
    house_manager: agreementData.houseManager,
    excluded_work_types: agreementData.excludedWorkTypes,
    work_schedule: agreementData.workSchedule,
    additional_terms: agreementData.additionalTerms || '',
  };

  // Replace all placeholders
  let parsed = templateContent;

  // Special handling for additional_terms - add conditional intro text
  const additionalTerms = agreementData.additionalTerms?.trim();
  if (additionalTerms) {
    parsed = parsed.replace(
      /\{\{additional_terms\}\}/g,
      additionalTerms
    );
  } else {
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
    emergencyContact: 'Jane Smith - 512-555-5678',
    dwellingDescription: 'the cabin on the west most part of the property (farthest from the house)',
    rate: '$599',
    securityDeposit: '$300',
    payRate: '$25',
    payRateTerms: 'for first 90 days. Negotiated rate after 90 days.',
    minHoursPerWeek: '6',
    agreementStartDate: 'June 30, 2024',
    noticePeriod: '2 weeks',
    signingDate: 'February 6, 2026',
    houseManager: 'Rahul Sonnad',
    excludedWorkTypes: 'None specified',
    workSchedule: 'Flexible, coordinated with house manager',
    additionalTerms: 'Renter agrees to maintain the garden area.',
  };

  return parseTemplate(templateContent, sampleData);
}

/**
 * Get the default template content (based on Alpaca Playhouse Work Trade Agreement)
 */
function getDefaultTemplate() {
  return `# Work Agreement for Residents of the Alpaca Playhouse

**Date: {{signing_date}}**

---

The following are the Terms of the Worktrade agreement between the Revocable Trust of Subhash Sonnad (dba the "Alpaca Playhouse"), and the following individual, referred to as "renter":

**{{tenant_name}}**

renter agrees to follow the following:

## Unit

The renter shall take {{dwelling_description}}.

## Monthly Rent

**{{rate}}**

- The renter will place a security/cleaning deposit of **{{security_deposit}}**. Some portion of the deposit can be worked during the first month.

## Agreement Start Date

**{{agreement_start_date}}**

## Termination

Either party may terminate the agreement with {{notice_period}} notice.

## Work Terms

- If the renter fails to fulfill the prescribed work (i.e. minimum {{min_hours_per_week}} hours/week) and processes (at the discretion of the Alpaca Playhouse) he/she will be informed by email, and the rental agreement will terminate at the end of the current month and the rental cost will be taken from the deposit, unless a modification is agreed to by both parties in writing.

- The renter will work according to tasks assigned by house manager: {{house_manager}}.

- The renter requests that the following types of work not be assigned. Other than these types of work, a variety of work may be assigned based on the changing needs of the Alpaca Playhouse.

{{excluded_work_types}}

- The renter will work according to the following schedule:

{{work_schedule}}

## Pay Rate

**{{pay_rate}}/hour**, {{pay_rate_terms}}

**Minimum hours/week:** {{min_hours_per_week}} - unless notification is made and agreed upon.

## Work Reporting

- The renter will send an email summary at the end of each day where work is performed outlining the work completed and the hours to alpacaplayhouse@gmail.com. This email must be sent on each and every day when work is performed (before the end of the day).

- Hours for work not reported on the same day by email will be discounted 25%.

- Additional hours may be completed if agreed in advance and confirmed in writing by email.

- Renter will be paid at the end of the month for any excess hours (beyond the value of the next month's rent) by direct deposit or check, which may take 3-5 days to process, on a 1099 contract.

- As appropriate, the renter will use Monday task management software to determine assignments, manage work, and track hours. Monday will be updated each day that work is completed, prior to sending the summary email.

- Due to the wide range of tasks required to manage the property, the renter agrees to complete the highest priority tasks as outlined on Monday or other system, which may include: cleaning, organization, landscaping, building assistance, electronics management, or other tasks.

- The renter will be available for weekly calls (15 minutes) to review completed and upcoming tasks. These calls may not be required if work tasks do not warrant.

## Departure Terms

- If the renter chooses not to renew their monthly rental agreement, they will give {{notice_period}} notice, and will be paid for all hours of the month at the end of the month. If the renter fails to give {{notice_period}} notice, half a month's rent will be deducted from the deposit.

- At the end of each month, renter will provide a monthly summary within 4 days of the end of the month, indicating hours worked, tasks completed and balance of dollars.

## Additional Terms

{{additional_terms}}

---

## SIGNATURES

**Signed By:**

Signature: _________________________

Rahul Sonnad - Revocable Trust of Subhash Sonnad - dba Alpaca Playhouse
160 Still Forest Drive Cedar Creek TX 78612

Date: _________________________


**Signed By Worktrade Renter:**

Signature: _________________________

Renter: {{tenant_name}}

Date: _________________________

Phone: {{tenant_phone}}

Email: {{tenant_email}}

Emergency Contact & Phone #: {{emergency_contact}}

---

**Payments:** bit.ly/alpacapay
`;
}

export const worktradeTemplateService = {
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
