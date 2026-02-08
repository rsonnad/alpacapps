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
    throw new Error(errorData.message || `SignWell API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Create a document for signing
 * @param {string} pdfUrl - URL of the PDF to sign (must be publicly accessible)
 * @param {string} recipientEmail - Email address of the signer
 * @param {string} recipientName - Name of the signer
 * @param {Object} options - Additional options
 */
async function createDocument(pdfUrl, recipientEmail, recipientName, options = {}) {
  const config = await getConfig();

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
        name: recipientName,
        email: recipientEmail,
        role: 'Tenant',
      },
    ],
    // Add signature field at the bottom of the document
    // fields is a 2D array — one array of fields per file
    fields: [
      [
        {
          type: 'signature',
          required: true,
          recipient_id: '1',
          page: 1,
          x: 50,
          y: 650,
          width: 200,
          height: 50,
        },
        {
          type: 'date',
          required: true,
          recipient_id: '1',
          page: 1,
          x: 50,
          y: 720,
          width: 100,
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
 */
async function sendForSignature(applicationId, pdfUrl, recipientEmail, recipientName) {
  // Create document in SignWell
  const document = await createDocument(pdfUrl, recipientEmail, recipientName, {
    documentName: `Lease Agreement - ${recipientName}`,
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
