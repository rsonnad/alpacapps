/**
 * SignWell Service
 * Integrates with SignWell API for electronic signature collection
 * API Documentation: https://developers.signwell.com/
 */

import { supabase } from './supabase.js';

const SIGNWELL_API_BASE = 'https://www.signwell.com/api/v1';

/**
 * Get SignWell configuration from database
 */
async function getConfig() {
  const { data, error } = await supabase
    .from('signwell_config')
    .select('*')
    .single();

  if (error) {
    console.error('Error fetching SignWell config:', error);
    throw new Error('SignWell not configured. Please add your API key in Settings.');
  }

  if (!data.api_key) {
    throw new Error('SignWell API key not configured. Please add your API key in Settings.');
  }

  return data;
}

/**
 * Make authenticated request to SignWell API
 */
async function signwellRequest(endpoint, options = {}) {
  const config = await getConfig();

  const response = await fetch(`${SIGNWELL_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'X-Api-Key': config.api_key,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err = new Error(errorData.message || `SignWell API error: ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

/**
 * Create a document for signing
 * @param {string} pdfUrl - URL of the PDF to sign (must be publicly accessible)
 * @param {string} recipientEmail - Email address of the signer (tenant)
 * @param {string} recipientName - Name of the signer (tenant)
 * @param {Object} options - Additional options
 * @param {number} options.pageCount - Total pages in the PDF (signature fields go on last page)
 * @param {string} options.documentName - Custom document name
 */
async function createDocument(pdfUrl, recipientEmail, recipientName, options = {}) {
  const config = await getConfig();

  // Signature fields go on the last page where the signature lines are in the template.
  // The lease template has: Landlord signature first, then Tenant signature below.
  // A4 page at 72 DPI is approximately 595 x 842 pixels.
  const signaturePage = options.pageCount || 1;

  const documentData = {
    test_mode: config.test_mode,
    files: [
      {
        name: `${options.documentName || 'Lease Agreement'}.pdf`,
        file_url: pdfUrl,
      },
    ],
    name: options.documentName || 'Lease Agreement',
    recipients: [
      {
        id: '1',
        name: 'Rahul Sonnad',
        email: 'alpacaplayhouse@gmail.com',
        role: 'Landlord',
      },
      {
        id: '2',
        name: recipientName,
        email: recipientEmail,
        role: 'Tenant',
      },
    ],
    // fields is a 2D array — one array of fields per file
    // Positions based on the lease template layout:
    //   "Landlords Signature:" line ~ y=530 on last page
    //   "Tenants Signature:" line ~ y=640 on last page
    fields: [
      [
        // Landlord signature + date
        {
          type: 'signature',
          required: true,
          recipient_id: '1',
          page: signaturePage,
          x: 50,
          y: 520,
          width: 200,
          height: 40,
        },
        {
          type: 'date',
          required: true,
          recipient_id: '1',
          page: signaturePage,
          x: 50,
          y: 580,
          width: 120,
          height: 20,
        },
        // Tenant signature + date
        {
          type: 'signature',
          required: true,
          recipient_id: '2',
          page: signaturePage,
          x: 50,
          y: 630,
          width: 200,
          height: 40,
        },
        {
          type: 'date',
          required: true,
          recipient_id: '2',
          page: signaturePage,
          x: 50,
          y: 690,
          width: 120,
          height: 20,
        },
      ],
    ],
    // Send email automatically
    delivery: 'email',
  };

  const result = await signwellRequest('/documents', {
    method: 'POST',
    body: JSON.stringify(documentData),
  });

  return result;
}

/**
 * Get document status
 * @param {string} documentId - SignWell document ID
 */
async function getDocumentStatus(documentId) {
  const result = await signwellRequest(`/documents/${documentId}`);
  return result;
}

/**
 * Download completed/signed PDF
 * @param {string} documentId - SignWell document ID
 */
async function downloadSignedPdf(documentId) {
  const config = await getConfig();

  const response = await fetch(`${SIGNWELL_API_BASE}/documents/${documentId}/completed_pdf`, {
    headers: {
      'X-Api-Key': config.api_key,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download signed PDF: ${response.status}`);
  }

  return response.blob();
}

/**
 * Send a reminder to signer
 * @param {string} documentId - SignWell document ID
 */
async function sendReminder(documentId) {
  const result = await signwellRequest(`/documents/${documentId}/send_reminder`, {
    method: 'POST',
  });
  return result;
}

/**
 * Delete/cancel a document
 * @param {string} documentId - SignWell document ID
 */
async function deleteDocument(documentId) {
  const result = await signwellRequest(`/documents/${documentId}`, {
    method: 'DELETE',
  });
  return result;
}

/**
 * Update rental application with SignWell document info
 */
async function linkDocumentToApplication(applicationId, signwellDocumentId) {
  const { error } = await supabase
    .from('rental_applications')
    .update({
      signwell_document_id: signwellDocumentId,
      agreement_status: 'sent',
      agreement_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  if (error) throw error;
}

/**
 * Full workflow: Send document for signature
 * 1. Creates document in SignWell
 * 2. Links to rental application
 * 3. Returns document info
 * @param {number} pageCount - Total pages in the PDF (for signature field placement)
 */
async function sendForSignature(applicationId, pdfUrl, recipientEmail, recipientName, pageCount) {
  // Create document in SignWell
  const document = await createDocument(pdfUrl, recipientEmail, recipientName, {
    documentName: `Lease Agreement - ${recipientName}`,
    pageCount,
  });

  // Link to application
  await linkDocumentToApplication(applicationId, document.id);

  return document;
}

export const signwellService = {
  getConfig,
  createDocument,
  getDocumentStatus,
  downloadSignedPdf,
  sendReminder,
  deleteDocument,
  linkDocumentToApplication,
  sendForSignature,
};
