/**
 * SignWell Webhook Handler
 * Receives webhook notifications when documents are signed
 *
 * Deploy with: supabase functions deploy signwell-webhook
 * Webhook URL: https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/signwell-webhook
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignWellWebhookPayload {
  event: string;
  document_id: string;
  document_name: string;
  status: string;
  completed_at?: string;
  recipients?: Array<{
    name: string;
    email: string;
    status: string;
    signed_at?: string;
  }>;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse webhook payload
    const payload: SignWellWebhookPayload = await req.json();
    console.log('SignWell webhook received:', payload);

    // Only handle document_completed events
    if (payload.event !== 'document_completed') {
      console.log(`Ignoring event: ${payload.event}`);
      return new Response(
        JSON.stringify({ message: 'Event ignored', event: payload.event }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const documentId = payload.document_id;

    // Find the rental application with this SignWell document ID
    const { data: application, error: findError } = await supabase
      .from('rental_applications')
      .select(`
        id,
        generated_pdf_url,
        approved_rate,
        security_deposit,
        person:person_id (
          id,
          first_name,
          last_name,
          email
        )
      `)
      .eq('signwell_document_id', documentId)
      .single();

    if (findError || !application) {
      console.error('Application not found for document:', documentId);
      return new Response(
        JSON.stringify({ error: 'Application not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get SignWell config for API key
    const { data: config, error: configError } = await supabase
      .from('signwell_config')
      .select('api_key')
      .single();

    if (configError || !config?.api_key) {
      console.error('SignWell config not found');
      return new Response(
        JSON.stringify({ error: 'SignWell not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Download the signed PDF from SignWell
    const pdfResponse = await fetch(
      `https://www.signwell.com/api/v1/documents/${documentId}/completed_pdf`,
      {
        headers: {
          'X-Api-Key': config.api_key,
        },
      }
    );

    if (!pdfResponse.ok) {
      throw new Error(`Failed to download signed PDF: ${pdfResponse.status}`);
    }

    const pdfBlob = await pdfResponse.blob();
    const pdfBuffer = await pdfBlob.arrayBuffer();

    // Generate smart filename: "Alpaca Rental Agreement (Signed) [Name] [Date].pdf"
    const person = application.person as { id: string; first_name: string; last_name: string; email: string } | null;
    const tenantName = person
      ? `${person.first_name || ''} ${person.last_name || ''}`.trim().replace(/[^a-zA-Z0-9\s]/g, '').substring(0, 30)
      : 'Unknown';
    const dateStr = new Date().toISOString().split('T')[0];
    const displayFilename = `Alpaca Rental Agreement (Signed) ${tenantName} ${dateStr}.pdf`;
    // Storage path uses application ID for uniqueness
    const storagePath = `signed-lease-${application.id}-${Date.now()}.pdf`;

    // Upload to Supabase storage
    const { error: uploadError } = await supabase.storage
      .from('lease-documents')
      .upload(`signed/${storagePath}`, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Error uploading signed PDF:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('lease-documents')
      .getPublicUrl(`signed/${storagePath}`);

    const signedPdfUrl = urlData.publicUrl;

    // Update the rental application
    const { error: updateError } = await supabase
      .from('rental_applications')
      .update({
        agreement_status: 'signed',
        agreement_signed_at: new Date().toISOString(),
        signed_pdf_url: signedPdfUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', application.id);

    if (updateError) {
      console.error('Error updating application:', updateError);
      throw updateError;
    }

    console.log(`Document ${documentId} signed and processed successfully`);

    // Send email notification via send-email function
    if (person?.email) {
      try {
        const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
        if (RESEND_API_KEY) {
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Alpaca Playhouse <noreply@alpacaplayhouse.com>',
              to: [person.email],
              reply_to: 'hello@alpacaplayhouse.com',
              subject: 'Lease Signed Successfully - Alpaca Playhouse',
              html: `
                <h2>Lease Signing Complete!</h2>
                <p>Hi ${person.first_name},</p>
                <p>Your lease agreement has been successfully signed. A copy will be provided for your records.</p>
                <p><strong>Next Steps:</strong></p>
                <ul>
                  <li>Submit your move-in deposit: <strong>$${application.approved_rate || 'TBD'}</strong></li>
                  ${application.security_deposit ? `<li>Submit your security deposit: <strong>$${application.security_deposit}</strong></li>` : ''}
                </ul>
                <p>Once deposits are received, we'll confirm your move-in date.</p>
                <p>Best regards,<br>Alpaca Playhouse</p>
              `,
              text: `Lease Signing Complete!\n\nHi ${person.first_name},\n\nYour lease agreement has been successfully signed. A copy will be provided for your records.\n\nNext Steps:\n- Submit your move-in deposit: $${application.approved_rate || 'TBD'}\n${application.security_deposit ? `- Submit your security deposit: $${application.security_deposit}` : ''}\n\nOnce deposits are received, we'll confirm your move-in date.\n\nBest regards,\nAlpaca Playhouse`,
            }),
          });

          if (emailResponse.ok) {
            console.log('Lease signed notification email sent to', person.email);
          } else {
            const emailError = await emailResponse.json();
            console.error('Failed to send email:', emailError);
          }
        } else {
          console.log('RESEND_API_KEY not configured, skipping email');
        }
      } catch (emailErr) {
        console.error('Error sending email:', emailErr);
        // Don't fail the webhook for email errors
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Document signed and processed',
        applicationId: application.id,
        signedPdfUrl,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
